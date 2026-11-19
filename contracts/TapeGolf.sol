// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IProcessorRegistry, ICircuitsLite} from "./interfaces/ITapeOutLite.sol";

/// @title TapeGolf
/// @notice Sponsor-funded, exhaustively graded combinational circuit contests. No administrator.
/// @dev Compile with the project's pinned Solidity 0.8.28 / Cancun configuration.
/// Registry and registered processors are trusted protocol dependencies; see ../../SPIKE.md.
/// Commitments bind content, not IDs. Designers should commit BEFORE tape-out; the protocol
/// exposes no tape-out timestamp, so that chronology cannot itself be proven here.
/// Contests accept only flat NAND-only circuits (REF-free and latch-free): REF wrappers
/// copy gate count and results at zero cost, and REF targets can be pre-committed to before they exist.
/// This makes the EVAL_GAS_BUDGET estimate exact for gate accounting: no REF costs can appear.
contract TapeGolf is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum protocol fee in basis points (5%).
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Maximum input bits, bounding exhaustive grading to 256 vectors.
    uint8 public constant MAX_INPUTS = 8;
    /// @notice Maximum output bits, fitting each result into one byte.
    uint8 public constant MAX_OUTPUTS = 8;
    /// @notice Absolute limit on submitted netlist bytes.
    uint32 public constant MAX_NETLIST_BYTES = 4096;
    /// @notice Minimum duration of each commit and reveal phase.
    uint64 public constant MIN_PHASE = 1 hours;
    /// @notice Maximum estimated gas admitted for a full evaluation sweep.
    uint256 public constant EVAL_GAS_BUDGET = 60_000_000;
    /// @notice Base per-vector allowance; measured ~9k (see ../../SPIKE.md).
    uint256 public constant GAS_PER_EVAL_BASE = 10_000;
    /// @notice Per-flat-gate per-vector allowance; measured ~2.36k (see ../../SPIKE.md).
    uint256 public constant GAS_PER_GATE = 2_500;

    IProcessorRegistry public immutable registry;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;

    enum Phase { Commit, Reveal, Ended, Settled }

    struct CreateParams {
        IERC20 token;
        uint256 prize;
        address processor; // zero accepts any registered processor
        uint8 nIn;
        uint8 nOut;
        bytes expected;
        uint32 maxGates;
        uint32 maxNetlistBytes;
        uint64 commitDeadline;
        uint64 revealDeadline;
    }

    struct Contest {
        address sponsor;
        IERC20 token;
        uint256 prize;
        address processor;
        uint8 nIn;
        uint8 nOut;
        uint32 maxGates;
        uint32 maxNetlistBytes;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint32 commitCount;
        bool settled;
    }

    struct Commitment {
        bytes32 commitment;
        uint32 order;
        bool revealed;
    }

    struct Leader {
        address designer;
        uint32 gateCount;
        uint32 order;
        address circuits;
        uint256 circuitId;
    }

    uint256 private _contestCount;
    mapping(uint256 => Contest) private _contests;
    mapping(uint256 => bytes) private _expected;
    mapping(uint256 => mapping(address => Commitment)) private _commits;
    mapping(uint256 => Leader) private _leaders;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) private _used;
    mapping(IERC20 => mapping(address => uint256)) private _pending;

    error ZeroRegistry();
    error ZeroFeeRecipient();
    error FeeTooHigh(uint16 feeBps);
    error InvalidInputs(uint8 nIn);
    error InvalidOutputs(uint8 nOut);
    error InvalidExpectedLength(uint256 got, uint256 want);
    error InvalidExpectedByte(uint256 vector, uint8 value);
    error ZeroPrize();
    error TokenHasNoCode(address token);
    error InvalidMaxGates();
    error InvalidMaxNetlistBytes(uint32 value);
    error EvaluationBudgetExceeded(uint256 estimate);
    error InvalidCommitDeadline();
    error InvalidRevealDeadline();
    error UnregisteredProcessor(address processor);
    error IncorrectPrizeReceived(uint256 expected, uint256 received);
    error ContestNotFound(uint256 contestId);
    error CommitPhaseClosed();
    error AlreadyCommitted();
    error TooManyCommits();
    error NotRevealPhase();
    error NoCommitment();
    error AlreadyRevealed();
    error ProcessorMismatch(address got, address want);
    error NotCircuitOwner(address owner);
    error CircuitAlreadyUsed(address circuits, uint256 circuitId);
    error InputCountMismatch(uint32 got, uint8 want);
    error OutputCountMismatch(uint32 got, uint8 want);
    error StatefulCircuit(uint32 nState);
    error TooManyGates(uint32 got, uint32 maximum);
    error NetlistTooLarge(uint256 got, uint32 maximum);
    error CommitmentMismatch();
    error NonFlatNetlist();
    error GateCountMismatch(uint32 reported, uint256 actual);
    error EmptyEvaluation(uint256 vector);
    error TruthTableMismatch(uint256 vector, uint8 got, uint8 want);
    error ContestNotEnded();
    error AlreadySettled();
    error NothingToClaim();

    event ContestCreated(
        uint256 indexed contestId, address indexed sponsor, IERC20 indexed token,
        uint256 prize, address processor, uint64 commitDeadline, uint64 revealDeadline
    );
    event Committed(uint256 indexed contestId, address indexed designer, bytes32 commitment, uint32 order);
    event Revealed(
        uint256 indexed contestId, address indexed designer, address indexed circuits,
        uint256 id, uint32 gateCount, bool becameLeader
    );
    event Settled(uint256 indexed contestId, address indexed winner, uint256 winnerPayout, uint256 fee);
    event Claimed(IERC20 indexed token, address indexed account, uint256 amount);

    /// @notice Fix the registry and fee terms permanently. The registry must be nonzero.
    constructor(IProcessorRegistry registry_, address feeRecipient_, uint16 feeBps_) {
        if (address(registry_) == address(0)) revert ZeroRegistry();
        if (feeRecipient_ == address(0)) revert ZeroFeeRecipient();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        registry = registry_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /// @notice Create a contest and escrow exactly its advertised ERC-20 prize.
    /// @dev Fee-on-transfer funding is rejected; tokens must remain solvent and transferable.
    function createContest(CreateParams calldata p) external nonReentrant returns (uint256 id) {
        _validateCreate(p);
        id = ++_contestCount;
        Contest storage c = _contests[id];
        c.sponsor = msg.sender;
        c.token = p.token;
        c.prize = p.prize;
        c.processor = p.processor;
        c.nIn = p.nIn;
        c.nOut = p.nOut;
        c.maxGates = p.maxGates;
        c.maxNetlistBytes = p.maxNetlistBytes;
        c.commitDeadline = p.commitDeadline;
        c.revealDeadline = p.revealDeadline;
        _expected[id] = p.expected;

        uint256 beforeBalance = p.token.balanceOf(address(this));
        p.token.safeTransferFrom(msg.sender, address(this), p.prize);
        uint256 afterBalance = p.token.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != p.prize) revert IncorrectPrizeReceived(p.prize, received);
        emit ContestCreated(id, msg.sender, p.token, p.prize, p.processor, p.commitDeadline, p.revealDeadline);
    }

    /// @notice Commit once per contest, before its commit deadline. Order starts at one.
    function commit(uint256 contestId, bytes32 commitment) external nonReentrant {
        Contest storage c = _contest(contestId);
        if (block.timestamp >= c.commitDeadline) revert CommitPhaseClosed();
        Commitment storage entry = _commits[contestId][msg.sender];
        if (entry.order != 0) revert AlreadyCommitted();
        if (c.commitCount == type(uint32).max) revert TooManyCommits();
        uint32 order = ++c.commitCount;
        entry.commitment = commitment;
        entry.order = order;
        emit Committed(contestId, msg.sender, commitment, order);
    }

    /// @notice Compute the domain-separated commitment to exact netlist content.
    function commitmentOf(uint256 contestId, address designer, bytes32 netlistHash, bytes32 salt)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(address(this), block.chainid, contestId, designer, netlistHash, salt));
    }

    /// @notice Reveal an owned, registered circuit and grade every vector atomically.
    /// @dev Failed grading consumes neither the commitment nor the circuit. External reads use STATICCALL.
    /// Only flat NAND-only circuits (REF-free and latch-free) are accepted: REF wrappers copy gate count
    /// and results at zero cost, and REF targets can be pre-committed to before they exist.
    /// This makes the EVAL_GAS_BUDGET estimate exact for gate accounting because no REF costs can appear.
    function reveal(uint256 contestId, address circuits, uint256 id, bytes32 salt) external nonReentrant {
        Contest storage c = _contest(contestId);
        if (block.timestamp < c.commitDeadline || block.timestamp >= c.revealDeadline) revert NotRevealPhase();
        Commitment storage entry = _commits[contestId][msg.sender];
        if (entry.order == 0) revert NoCommitment();
        if (entry.revealed) revert AlreadyRevealed();
        uint32 gates = _checkCircuit(contestId, c, circuits, id, entry.commitment, salt);
        _grade(contestId, c, ICircuitsLite(circuits), id);

        entry.revealed = true;
        _used[contestId][circuits][id] = true;
        Leader storage leader = _leaders[contestId];
        bool becameLeader = leader.designer == address(0) || gates < leader.gateCount
            || (gates == leader.gateCount && entry.order < leader.order);
        if (becameLeader) {
            _leaders[contestId] = Leader(msg.sender, gates, entry.order, circuits, id);
        }
        emit Revealed(contestId, msg.sender, circuits, id, gates, becameLeader);
    }

    /// @notice Finalize an ended contest using credits only; no token transfer can block settlement.
    function settle(uint256 contestId) external nonReentrant {
        _settle(contestId);
    }

    /// @notice Finalize then claim the winner's (or refunded sponsor's) entire pending token balance.
    /// @dev If payment fails this transaction rolls back; plain settle remains independently callable.
    /// The fee stays claimable, except when its recipient is also the payout account.
    function settleAndPay(uint256 contestId) external nonReentrant {
        (IERC20 token, address account) = _settle(contestId);
        _claim(token, account);
    }

    /// @notice Permissionlessly send an account's full pending balance to that account, never the caller.
    function claim(IERC20 token, address account) external nonReentrant {
        _claim(token, account);
    }

    /// @notice Return the number of contests; IDs start at one.
    function contestCount() external view returns (uint256) { return _contestCount; }

    /// @notice Return contest metadata, excluding its separately stored truth table.
    function getContest(uint256 id) external view returns (Contest memory) { return _contest(id); }

    /// @notice Return the expected output byte for each vector, ordered from zero.
    function expectedOf(uint256 id) external view returns (bytes memory) {
        _contest(id);
        return _expected[id];
    }

    /// @notice Return an account's commitment, commit order, and successful-reveal flag.
    function commitOf(uint256 id, address account) external view returns (bytes32 commitment, uint32 order, bool revealed) {
        _contest(id);
        Commitment storage entry = _commits[id][account];
        return (entry.commitment, entry.order, entry.revealed);
    }

    /// @notice Return the current leader; a zero designer means no successful reveal.
    function leaderOf(uint256 id) external view returns (
        address designer, uint32 gateCount, uint32 order, address circuits, uint256 circuitId
    ) {
        _contest(id);
        Leader storage leader = _leaders[id];
        return (leader.designer, leader.gateCount, leader.order, leader.circuits, leader.circuitId);
    }

    /// @notice Return an account's unclaimed credit for a token.
    function pendingOf(IERC20 token, address account) external view returns (uint256) {
        return _pending[token][account];
    }

    /// @notice Return the timestamp-derived phase, with settlement taking precedence.
    function phaseOf(uint256 id) external view returns (Phase) {
        Contest storage c = _contest(id);
        if (c.settled) return Phase.Settled;
        if (block.timestamp < c.commitDeadline) return Phase.Commit;
        if (block.timestamp < c.revealDeadline) return Phase.Reveal;
        return Phase.Ended;
    }

    function _validateCreate(CreateParams calldata p) private view {
        if (p.nIn == 0 || p.nIn > MAX_INPUTS) revert InvalidInputs(p.nIn);
        if (p.nOut == 0 || p.nOut > MAX_OUTPUTS) revert InvalidOutputs(p.nOut);
        uint256 vectors = uint256(1) << p.nIn;
        if (p.expected.length != vectors) revert InvalidExpectedLength(p.expected.length, vectors);
        uint8 mask = uint8((uint256(1) << p.nOut) - 1);
        for (uint256 v; v < vectors; ++v) {
            if ((uint8(p.expected[v]) & ~mask) != 0) revert InvalidExpectedByte(v, uint8(p.expected[v]));
        }
        if (p.prize == 0) revert ZeroPrize();
        if (address(p.token).code.length == 0) revert TokenHasNoCode(address(p.token));
        if (p.maxGates == 0) revert InvalidMaxGates();
        if (p.maxNetlistBytes < 7 || p.maxNetlistBytes > MAX_NETLIST_BYTES) {
            revert InvalidMaxNetlistBytes(p.maxNetlistBytes);
        }
        uint256 estimate = vectors * (GAS_PER_EVAL_BASE + GAS_PER_GATE * uint256(p.maxGates));
        if (estimate > EVAL_GAS_BUDGET) revert EvaluationBudgetExceeded(estimate);
        if (uint256(p.commitDeadline) < block.timestamp + MIN_PHASE) revert InvalidCommitDeadline();
        if (uint256(p.revealDeadline) < uint256(p.commitDeadline) + MIN_PHASE) revert InvalidRevealDeadline();
        if (p.processor != address(0) && !registry.isCPU(p.processor)) revert UnregisteredProcessor(p.processor);
    }

    function _checkCircuit(
        uint256 contestId, Contest storage c, address circuits, uint256 id, bytes32 committed, bytes32 salt
    ) private view returns (uint32 gateCount) {
        if (c.processor != address(0)) {
            if (circuits != c.processor) revert ProcessorMismatch(circuits, c.processor);
        } else if (!registry.isCPU(circuits)) {
            revert UnregisteredProcessor(circuits);
        }
        ICircuitsLite circuit = ICircuitsLite(circuits);
        address owner = circuit.ownerOf(id);
        if (owner != msg.sender) revert NotCircuitOwner(owner);
        if (_used[contestId][circuits][id]) revert CircuitAlreadyUsed(circuits, id);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = circuit.circuitInfo(id);
        if (nIn != c.nIn) revert InputCountMismatch(nIn, c.nIn);
        if (nOut != c.nOut) revert OutputCountMismatch(nOut, c.nOut);
        if (nState != 0) revert StatefulCircuit(nState);
        if (gates > c.maxGates) revert TooManyGates(gates, c.maxGates);
        bytes memory netlistBytes = circuit.netlist(id);
        if (netlistBytes.length > c.maxNetlistBytes) revert NetlistTooLarge(netlistBytes.length, c.maxNetlistBytes);
        if (commitmentOf(contestId, msg.sender, keccak256(netlistBytes), salt) != committed) revert CommitmentMismatch();
        if (netlistBytes.length % 7 != 0) revert NonFlatNetlist();
        // At most MAX_NETLIST_BYTES / 7 records after the existing length check.
        for (uint256 k; k < netlistBytes.length / 7; ++k) {
            if (netlistBytes[7 * k] != 0x00) revert NonFlatNetlist();
        }
        uint256 actual = netlistBytes.length / 7;
        if (gates != actual) revert GateCountMismatch(gates, actual);
        return gates;
    }

    function _grade(uint256 contestId, Contest storage c, ICircuitsLite circuit, uint256 id) private view {
        bytes memory expected = _expected[contestId];
        uint8 mask = uint8((uint256(1) << c.nOut) - 1);
        for (uint256 v; v < expected.length; ++v) {
            bytes memory out = circuit.eval(id, abi.encodePacked(uint8(v)));
            if (out.length == 0) revert EmptyEvaluation(v);
            uint8 got = uint8(out[0]) & mask;
            uint8 want = uint8(expected[v]);
            if (got != want) revert TruthTableMismatch(v, got, want);
        }
    }

    function _settle(uint256 contestId) private returns (IERC20 token, address account) {
        Contest storage c = _contest(contestId);
        if (c.settled) revert AlreadySettled();
        if (block.timestamp < c.revealDeadline) revert ContestNotEnded();
        c.settled = true;
        token = c.token;
        address winner = _leaders[contestId].designer;
        uint256 fee = 0; // stays zero on a refund (no winner): no fee is taken from a refunded prize
        uint256 payout = c.prize;
        if (winner == address(0)) {
            account = c.sponsor;
        } else {
            account = winner;
            fee = Math.mulDiv(c.prize, feeBps, 10_000);
            payout -= fee;
            if (fee != 0) _pending[token][feeRecipient] += fee;
        }
        _pending[token][account] += payout;
        // No winner: winner is zero, winnerPayout is the full sponsor refund.
        emit Settled(contestId, winner, payout, fee);
    }

    function _claim(IERC20 token, address account) private {
        uint256 amount = _pending[token][account];
        if (amount == 0) revert NothingToClaim();
        _pending[token][account] = 0;
        token.safeTransfer(account, amount);
        emit Claimed(token, account, amount);
    }

    function _contest(uint256 id) private view returns (Contest storage c) {
        if (id == 0 || id > _contestCount) revert ContestNotFound(id);
        return _contests[id];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IProcessorRegistry, ICircuitsLite} from "./interfaces/ITapeOutLite.sol";

/// @title Arena
/// @notice Sponsor-funded circuit-design challenges on TapeOut (X Layer). A sponsor posts a truth table and a pot.
///         Designers commit, then reveal a taped-out circuit. The contract grades every reveal itself by running
///         every input vector through the circuit's `eval`. The lowest gate count wins; ties go to the earliest
///         commit. The winner is paid the pot minus a fee, through pull payments.
/// @dev Every TapeOut fact used here comes from SPIKE.md: `registry.isCPU` is keyed by the circuits address (C1),
///      `eval` takes one input byte and answers in byte 0 for at most 8 inputs and outputs (C6, C7), latch circuits
///      revert in `eval` (C9), `circuitInfo(id).gateCount` is readable and flattened through REFs (C11, C13), and
///      `ownerOf` is the tape-out sender and reverts for unknown ids (C16). No TapeOut address is hardcoded.
///
///      KNOWN LIMITATION (by the requested design). The commit hash binds only (circuitId, salt, sender). It does not
///      bind the netlist content. SPIKE.md C14 shows that a zero-cost REF wrapper has the same gate count and the same
///      results as the circuit it wraps, and that ids are sequential (C5). So the earliest-commit tie-break can be
///      gamed: someone can commit to a circuit id before the honest circuit exists, or right after it becomes public,
///      and then reveal a wrapper or an exact copy. Lowest gate count still cannot be beaten this way, only tied.
///      SPIKE.md go/no-go item 1 recommends binding the commit to the netlist hash instead.
///
///      The contract has no owner, no pause and no upgrade path. Nobody can reach a pot except through the rules
///      below. The fee rate and the fee recipient are fixed at deployment and the rate is capped by `MAX_FEE_BPS`.
contract Arena is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Highest fee, in basis points, the deployment may charge (10%).
    uint16 public constant MAX_FEE_BPS = 1000;

    /// @notice Most inputs a challenge may have. `eval` takes the input vector as one byte (SPIKE C6).
    uint8 public constant MAX_INPUTS = 8;

    /// @notice Most outputs a challenge may have. `eval` answers in byte 0 (SPIKE C7).
    uint8 public constant MAX_OUTPUTS = 8;

    /// @notice Longest commit phase a challenge may have, measured from creation. Pots cannot be locked for longer.
    uint64 public constant MAX_COMMIT_WINDOW = 90 days;

    /// @notice Longest reveal phase a challenge may have. Pots cannot be locked for longer.
    uint64 public constant MAX_REVEAL_WINDOW = 90 days;

    /// @notice Most gas one reveal is allowed to spend on grading, as estimated from the gas fit below.
    /// @dev SPIKE.md: a 256-vector sweep of a 28-gate circuit costs about 19.3M gas, against a 210M block limit.
    uint256 public constant EVAL_GAS_BUDGET = 60_000_000;

    /// @notice Estimated fixed gas of one `eval` call (SPIKE.md gas fit: about 9k).
    uint256 public constant GAS_PER_EVAL_BASE = 10_000;

    /// @notice Estimated gas per flat gate of one `eval` call (SPIKE.md gas fit: about 2.36k).
    uint256 public constant GAS_PER_GATE = 2_500;

    // ---------------------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Lifecycle of a challenge, derived from time and the finalized flag.
    enum Phase {
        Commit,
        Reveal,
        Ended,
        Finalized
    }

    /// @notice A challenge. The truth table is stored separately (see `truthTableOf`).
    struct Challenge {
        address sponsor;
        uint64 commitEnd;
        uint64 revealEnd;
        IERC20 token;
        address processor;
        uint256 pot;
        uint8 nIn;
        uint8 nOut;
        uint32 commitCount;
        bool finalized;
        bool refundable;
    }

    /// @notice One account's commitment in one challenge.
    struct Commit {
        bytes32 hash;
        uint32 index;
        uint64 blockNumber;
        bool revealed;
    }

    /// @notice The leading valid reveal of a challenge.
    struct Best {
        address winner;
        uint32 score;
        uint32 commitIndex;
        uint64 commitBlock;
        uint256 circuitId;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Immutable configuration and storage
    // ---------------------------------------------------------------------------------------------------------

    /// @notice The TapeOut factory used to check that a challenge's processor is registered.
    IProcessorRegistry public immutable registry;

    /// @notice The only account that ever receives fees.
    address public immutable feeRecipient;

    /// @notice Fee taken from the pot at finalization, in basis points. Never above `MAX_FEE_BPS`.
    uint16 public immutable feeBps;

    /// @notice Number of challenges created. Ids run from 1 to this value.
    uint256 public challengeCount;

    mapping(uint256 => Challenge) private _challenges;
    mapping(uint256 => bytes) private _tables;
    mapping(uint256 => Best) private _best;
    mapping(uint256 => mapping(address => Commit)) private _commits;
    mapping(uint256 => mapping(uint256 => bool)) private _used;
    mapping(uint256 => mapping(address => uint256)) private _contributions;
    mapping(IERC20 => mapping(address => uint256)) private _pending;

    // ---------------------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------------------

    /// @notice A challenge was created and its pot funded.
    /// @param challengeId The new challenge id.
    /// @param sponsor The account that funded the pot.
    /// @param token The prize token.
    /// @param pot The initial pot.
    /// @param nIn Number of circuit inputs.
    /// @param nOut Number of circuit outputs.
    /// @param processor The circuits contract the challenge accepts.
    /// @param commitEnd Commits are accepted before this timestamp.
    /// @param revealEnd Reveals are accepted from `commitEnd` until this timestamp.
    /// @param packedTruthTable The packed truth table (encoding in `createChallenge`).
    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed sponsor,
        IERC20 indexed token,
        uint256 pot,
        uint8 nIn,
        uint8 nOut,
        address processor,
        uint64 commitEnd,
        uint64 revealEnd,
        bytes packedTruthTable
    );

    /// @notice Someone added to a pot.
    /// @param challengeId The challenge.
    /// @param funder The account that paid.
    /// @param amount The amount added.
    /// @param newPot The pot after the top-up.
    event ToppedUp(uint256 indexed challengeId, address indexed funder, uint256 amount, uint256 newPot);

    /// @notice An account committed.
    /// @param challengeId The challenge.
    /// @param committer The account.
    /// @param hash The commitment `keccak256(abi.encode(circuitId, salt, committer))`.
    /// @param commitIndex Position among this challenge's commits, starting at 1.
    /// @param commitBlock Block number of the commit.
    event Committed(
        uint256 indexed challengeId, address indexed committer, bytes32 hash, uint32 commitIndex, uint64 commitBlock
    );

    /// @notice A circuit passed every row and was revealed.
    /// @param challengeId The challenge.
    /// @param revealer The account that revealed.
    /// @param circuitId The circuit id on the challenge's processor.
    /// @param score The circuit's gate count.
    /// @param commitIndex The revealer's commit position.
    /// @param commitBlock The revealer's commit block.
    /// @param becameBest Whether this reveal took the lead.
    event Revealed(
        uint256 indexed challengeId,
        address indexed revealer,
        uint256 indexed circuitId,
        uint32 score,
        uint32 commitIndex,
        uint64 commitBlock,
        bool becameBest
    );

    /// @notice A challenge was finalized.
    /// @param challengeId The challenge.
    /// @param winner The winner, or the zero address when there was no valid reveal.
    /// @param circuitId The winning circuit id (zero when there is no winner).
    /// @param score The winning gate count (zero when there is no winner).
    /// @param payout Credited to the winner, or to the sponsor when there was no winner.
    /// @param fee Credited to the fee recipient (zero when there is no winner).
    event Finalized(
        uint256 indexed challengeId,
        address indexed winner,
        uint256 circuitId,
        uint32 score,
        uint256 payout,
        uint256 fee
    );

    /// @notice A contributor claimed their share of a pot that had no valid reveal.
    /// @param challengeId The challenge.
    /// @param account The contributor.
    /// @param amount The amount credited to their pending balance.
    event RefundClaimed(uint256 indexed challengeId, address indexed account, uint256 amount);

    /// @notice An account withdrew its pending balance.
    /// @param token The token.
    /// @param account The account that was paid.
    /// @param amount The amount sent.
    event Withdrawn(IERC20 indexed token, address indexed account, uint256 amount);

    // ---------------------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------------------

    /// @notice The registry address is zero.
    error ZeroRegistry();
    /// @notice The fee recipient is the zero address.
    error ZeroFeeRecipient();
    /// @notice The fee is above `MAX_FEE_BPS`.
    /// @param feeBps The rejected value.
    error FeeTooHigh(uint16 feeBps);
    /// @notice An amount that must be positive was zero.
    error ZeroAmount();
    /// @notice The prize token has no code.
    /// @param token The token address.
    error TokenHasNoCode(address token);
    /// @notice The input count is outside 1..`MAX_INPUTS`.
    /// @param nIn The rejected value.
    error InvalidInputs(uint8 nIn);
    /// @notice The output count is outside 1..`MAX_OUTPUTS`.
    /// @param nOut The rejected value.
    error InvalidOutputs(uint8 nOut);
    /// @notice The processor is zero or not registered with the factory.
    /// @param processor The rejected address.
    error UnregisteredProcessor(address processor);
    /// @notice The deadlines are not strictly increasing from now.
    error InvalidDeadlines();
    /// @notice A phase is longer than the allowed maximum, so the pot could be locked too long.
    /// @param window The requested phase length in seconds.
    /// @param maxWindow The allowed maximum in seconds.
    error DeadlineTooFar(uint256 window, uint256 maxWindow);
    /// @notice The packed truth table has the wrong byte length.
    /// @param got The supplied length.
    /// @param want The required length.
    error InvalidTableLength(uint256 got, uint256 want);
    /// @notice The unused high bits of the last table byte are not zero.
    error InvalidTablePadding();
    /// @notice The token moved a different amount than requested (for example a fee-on-transfer token).
    /// @param expected The requested amount.
    /// @param received The amount that arrived.
    error IncorrectAmountReceived(uint256 expected, uint256 received);
    /// @notice No challenge has this id.
    /// @param challengeId The id.
    error ChallengeNotFound(uint256 challengeId);
    /// @notice The challenge is already finalized.
    error AlreadyFinalized();
    /// @notice Commits are no longer accepted.
    error CommitPhaseClosed();
    /// @notice This account already committed to this challenge.
    error AlreadyCommitted();
    /// @notice Reveals are only accepted from `commitEnd` until `revealEnd`.
    error NotRevealPhase();
    /// @notice The caller has no commit in this challenge.
    error NoCommit();
    /// @notice The caller already revealed.
    error AlreadyRevealed();
    /// @notice The (circuitId, salt, caller) hash does not match the commit.
    error CommitMismatch();
    /// @notice The caller does not own the circuit.
    /// @param owner The actual owner.
    error NotCircuitOwner(address owner);
    /// @notice This circuit was already revealed in this challenge.
    /// @param circuitId The circuit id.
    error CircuitAlreadyUsed(uint256 circuitId);
    /// @notice The circuit has a different number of inputs.
    /// @param got The circuit's value.
    /// @param want The challenge's value.
    error InputCountMismatch(uint32 got, uint8 want);
    /// @notice The circuit has a different number of outputs.
    /// @param got The circuit's value.
    /// @param want The challenge's value.
    error OutputCountMismatch(uint32 got, uint8 want);
    /// @notice The circuit has latches; `eval` cannot grade it.
    /// @param nState The number of state bits.
    error StatefulCircuit(uint32 nState);
    /// @notice Grading this circuit would not fit the gas budget.
    /// @param gateCount The circuit's gate count.
    /// @param estimate The estimated gas.
    error CircuitTooExpensive(uint32 gateCount, uint256 estimate);
    /// @notice `eval` returned no bytes.
    /// @param vector The input vector.
    error EmptyEvaluation(uint256 vector);
    /// @notice The circuit gave a different answer than the truth table.
    /// @param vector The input vector.
    /// @param got The circuit's output bits.
    /// @param want The expected output bits.
    error TruthTableMismatch(uint256 vector, uint8 got, uint8 want);
    /// @notice The reveal phase has not ended yet.
    error ChallengeNotEnded();
    /// @notice Refunds are only available after a challenge finalized with no valid reveal.
    error RefundNotAvailable();
    /// @notice The caller has no contribution left to refund.
    error NothingToRefund();
    /// @notice The caller has nothing to withdraw in this token.
    error NothingToWithdraw();

    // ---------------------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------------------

    /// @param registry_ The TapeOut factory that answers `isCPU(circuits)`.
    /// @param feeRecipient_ The account that receives fees.
    /// @param feeBps_ Fee in basis points, at most `MAX_FEE_BPS`.
    constructor(IProcessorRegistry registry_, address feeRecipient_, uint16 feeBps_) {
        if (address(registry_) == address(0)) revert ZeroRegistry();
        if (feeRecipient_ == address(0)) revert ZeroFeeRecipient();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        registry = registry_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Sponsor and funders
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Create a challenge and fund its pot. The caller is the sponsor.
    /// @dev Packed truth table encoding: output bit `j` of input vector `v` is bit position `p = v * nOut + j`,
    ///      stored LSB first, so bit `p` is `(table[p >> 3] >> (p & 7)) & 1`. The table length must be
    ///      `ceil(2^nIn * nOut / 8)` bytes and the unused high bits of the last byte must be zero. Input vector `v`
    ///      sets input `i` to bit `i` of `v`, the same packing `eval` uses.
    /// @param token The prize token. Fee-on-transfer tokens are rejected.
    /// @param pot The prize, pulled from the caller now.
    /// @param nIn Number of inputs, 1 to `MAX_INPUTS`.
    /// @param nOut Number of outputs, 1 to `MAX_OUTPUTS`.
    /// @param packedTruthTable The expected outputs for every input vector.
    /// @param commitEnd Commits are accepted before this timestamp.
    /// @param revealEnd Reveals are accepted from `commitEnd` until this timestamp.
    /// @param processor The circuits contract this challenge accepts. Must be registered with the factory.
    /// @return id The new challenge id.
    function createChallenge(
        IERC20 token,
        uint256 pot,
        uint8 nIn,
        uint8 nOut,
        bytes calldata packedTruthTable,
        uint64 commitEnd,
        uint64 revealEnd,
        address processor
    ) external nonReentrant returns (uint256 id) {
        if (pot == 0) revert ZeroAmount();
        if (address(token).code.length == 0) revert TokenHasNoCode(address(token));
        if (nIn == 0 || nIn > MAX_INPUTS) revert InvalidInputs(nIn);
        if (nOut == 0 || nOut > MAX_OUTPUTS) revert InvalidOutputs(nOut);
        if (processor == address(0) || !registry.isCPU(processor)) revert UnregisteredProcessor(processor);
        if (commitEnd <= block.timestamp || revealEnd <= commitEnd) revert InvalidDeadlines();
        if (commitEnd - block.timestamp > MAX_COMMIT_WINDOW) revert DeadlineTooFar(commitEnd - block.timestamp, MAX_COMMIT_WINDOW);
        if (revealEnd - commitEnd > MAX_REVEAL_WINDOW) revert DeadlineTooFar(revealEnd - commitEnd, MAX_REVEAL_WINDOW);
        _checkTable(packedTruthTable, nIn, nOut);

        id = ++challengeCount;
        Challenge storage c = _challenges[id];
        c.sponsor = msg.sender;
        c.commitEnd = commitEnd;
        c.revealEnd = revealEnd;
        c.token = token;
        c.processor = processor;
        c.pot = pot;
        c.nIn = nIn;
        c.nOut = nOut;
        _tables[id] = packedTruthTable;
        _contributions[id][msg.sender] = pot;

        _pull(token, pot);
        _emitCreated(id, c, packedTruthTable);
    }

    /// @notice Add to a pot. Anyone may do this until the challenge is finalized.
    /// @dev If the challenge ends with no valid reveal, each contributor gets their own contribution back
    ///      (the sponsor at finalization, everyone else through `claimRefund`). Otherwise the whole pot goes to the winner.
    /// @param id The challenge id.
    /// @param amount The amount to add. Fee-on-transfer tokens are rejected.
    function topUp(uint256 id, uint256 amount) external nonReentrant {
        Challenge storage c = _get(id);
        if (c.finalized) revert AlreadyFinalized();
        if (amount == 0) revert ZeroAmount();
        uint256 newPot = c.pot + amount;
        c.pot = newPot;
        _contributions[id][msg.sender] += amount;
        _pull(c.token, amount);
        emit ToppedUp(id, msg.sender, amount, newPot);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Designers
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Compute the commitment for a circuit.
    /// @param circuitId The circuit id on the challenge's processor.
    /// @param salt A secret chosen by the designer.
    /// @param account The designer.
    /// @return The value to pass to `commit`: `keccak256(abi.encode(circuitId, salt, account))`.
    function commitHashOf(uint256 circuitId, bytes32 salt, address account) public pure returns (bytes32) {
        return keccak256(abi.encode(circuitId, salt, account));
    }

    /// @notice Commit to a circuit before the commit deadline. One commit per account per challenge.
    /// @dev The commit sequence index starts at 1 and only grows. Block numbers never decrease, so the index
    ///      orders commits exactly like (block number, position in the block).
    /// @param id The challenge id.
    /// @param h The commitment from `commitHashOf`.
    function commit(uint256 id, bytes32 h) external nonReentrant {
        Challenge storage c = _get(id);
        if (block.timestamp >= c.commitEnd) revert CommitPhaseClosed();
        Commit storage m = _commits[id][msg.sender];
        if (m.index != 0) revert AlreadyCommitted();
        uint32 index = c.commitCount + 1;
        c.commitCount = index;
        uint64 blockNumber = uint64(block.number);
        m.hash = h;
        m.index = index;
        m.blockNumber = blockNumber;
        emit Committed(id, msg.sender, h, index, blockNumber);
    }

    /// @notice Reveal a committed circuit. The contract runs every input vector through `eval`.
    /// @dev Checks, in order: reveal window, an unrevealed commit that matches `(circuitId, salt, caller)`, caller owns
    ///      the circuit, the circuit was not used before in this challenge, matching input and output counts, no
    ///      latches, a gas budget, then every vector. Any mismatch reverts the whole call, so the commit stays
    ///      unrevealed. The lowest gate count leads; equal gate counts go to the earlier commit, compared by commit
    ///      block and then commit index.
    /// @param id The challenge id.
    /// @param circuitId The circuit to reveal, on the challenge's processor.
    /// @param salt The salt used in the commitment.
    function reveal(uint256 id, uint256 circuitId, bytes32 salt) external nonReentrant {
        Challenge storage c = _get(id);
        if (block.timestamp < c.commitEnd || block.timestamp >= c.revealEnd) revert NotRevealPhase();
        Commit storage m = _commits[id][msg.sender];
        if (m.index == 0) revert NoCommit();
        if (m.revealed) revert AlreadyRevealed();
        if (commitHashOf(circuitId, salt, msg.sender) != m.hash) revert CommitMismatch();

        ICircuitsLite circuits = ICircuitsLite(c.processor);
        address circuitOwner = circuits.ownerOf(circuitId);
        if (circuitOwner != msg.sender) revert NotCircuitOwner(circuitOwner);
        if (_used[id][circuitId]) revert CircuitAlreadyUsed(circuitId);

        uint32 score = _checkInfo(c, circuits, circuitId);

        m.revealed = true;
        _used[id][circuitId] = true;

        _grade(id, c, circuits, circuitId);

        bool becameBest = _updateBest(id, score, m, circuitId);
        emit Revealed(id, msg.sender, circuitId, score, m.index, m.blockNumber, becameBest);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Settlement and payments
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Settle a challenge after the reveal deadline. Anyone may call it.
    /// @dev With a winner, the fee goes to `feeRecipient` and the rest of the pot to the winner, both as pending
    ///      balances. With no valid reveal, the sponsor's own contribution goes back to the sponsor and every other
    ///      contributor claims theirs through `claimRefund`. No tokens move here.
    /// @param id The challenge id.
    function finalize(uint256 id) external nonReentrant {
        Challenge storage c = _get(id);
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp < c.revealEnd) revert ChallengeNotEnded();
        c.finalized = true;

        Best storage b = _best[id];
        IERC20 token = c.token;
        uint256 fee = 0; // stays zero when there is no winner: a refunded pot pays no fee
        uint256 payout;
        if (b.winner != address(0)) {
            uint256 pot = c.pot;
            fee = Math.mulDiv(pot, feeBps, 10_000);
            payout = pot - fee;
            if (fee != 0) _pending[token][feeRecipient] += fee;
            _pending[token][b.winner] += payout;
        } else {
            c.refundable = true;
            payout = _contributions[id][c.sponsor];
            _contributions[id][c.sponsor] = 0;
            _pending[token][c.sponsor] += payout;
        }
        emit Finalized(id, b.winner, b.circuitId, b.score, payout, fee);
    }

    /// @notice Claim your own contribution to a challenge that ended with no valid reveal.
    /// @dev Credits your pending balance. Call `withdraw` to receive the tokens. The sponsor's own contribution is
    ///      already credited by `finalize`, so the sponsor has nothing left to claim here.
    /// @param id The challenge id.
    function claimRefund(uint256 id) external nonReentrant {
        Challenge storage c = _get(id);
        if (!c.refundable) revert RefundNotAvailable();
        uint256 amount = _contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();
        _contributions[id][msg.sender] = 0;
        _pending[c.token][msg.sender] += amount;
        emit RefundClaimed(id, msg.sender, amount);
    }

    /// @notice Withdraw your pending balance of a token (prize, fee, or refund).
    /// @param token The token to withdraw.
    function withdraw(IERC20 token) external nonReentrant {
        uint256 amount = _pending[token][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        _pending[token][msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(token, msg.sender, amount);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Read a challenge (without its truth table).
    /// @param id The challenge id.
    /// @return The challenge.
    function getChallenge(uint256 id) external view returns (Challenge memory) {
        return _get(id);
    }

    /// @notice Read a challenge's packed truth table.
    /// @param id The challenge id.
    /// @return The table bytes (encoding in `createChallenge`).
    function truthTableOf(uint256 id) external view returns (bytes memory) {
        _get(id);
        return _tables[id];
    }

    /// @notice Read an account's commit.
    /// @param id The challenge id.
    /// @param account The account.
    /// @return hash The commitment (zero when none).
    /// @return index The commit position, starting at 1 (zero when none).
    /// @return blockNumber The commit block.
    /// @return revealed Whether the account already revealed.
    function commitOf(uint256 id, address account)
        external
        view
        returns (bytes32 hash, uint32 index, uint64 blockNumber, bool revealed)
    {
        _get(id);
        Commit storage m = _commits[id][account];
        return (m.hash, m.index, m.blockNumber, m.revealed);
    }

    /// @notice Read the current leader of a challenge.
    /// @param id The challenge id.
    /// @return winner The leader (zero address when none yet).
    /// @return circuitId The leading circuit.
    /// @return score The leader's gate count.
    /// @return commitIndex The leader's commit position.
    function bestOf(uint256 id)
        external
        view
        returns (address winner, uint256 circuitId, uint32 score, uint32 commitIndex)
    {
        _get(id);
        Best storage b = _best[id];
        return (b.winner, b.circuitId, b.score, b.commitIndex);
    }

    /// @notice Read an account's recorded contribution to a challenge (refundable if nobody wins).
    /// @param id The challenge id.
    /// @param account The account.
    /// @return The amount.
    function contributionOf(uint256 id, address account) external view returns (uint256) {
        _get(id);
        return _contributions[id][account];
    }

    /// @notice Read an account's withdrawable balance of a token.
    /// @param token The token.
    /// @param account The account.
    /// @return The amount.
    function pendingOf(IERC20 token, address account) external view returns (uint256) {
        return _pending[token][account];
    }

    /// @notice Read a challenge's phase.
    /// @param id The challenge id.
    /// @return The phase.
    function phaseOf(uint256 id) external view returns (Phase) {
        Challenge storage c = _get(id);
        if (c.finalized) return Phase.Finalized;
        if (block.timestamp < c.commitEnd) return Phase.Commit;
        if (block.timestamp < c.revealEnd) return Phase.Reveal;
        return Phase.Ended;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------------------

    function _get(uint256 id) private view returns (Challenge storage c) {
        c = _challenges[id];
        if (c.sponsor == address(0)) revert ChallengeNotFound(id);
    }

    function _pull(IERC20 token, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert IncorrectAmountReceived(amount, received);
    }

    function _emitCreated(uint256 id, Challenge storage c, bytes calldata table) private {
        emit ChallengeCreated(id, c.sponsor, c.token, c.pot, c.nIn, c.nOut, c.processor, c.commitEnd, c.revealEnd, table);
    }

    function _checkTable(bytes calldata table, uint8 nIn, uint8 nOut) private pure {
        uint256 bitCount = (uint256(1) << nIn) * nOut;
        uint256 want = (bitCount + 7) / 8;
        if (table.length != want) revert InvalidTableLength(table.length, want);
        uint256 used = bitCount % 8;
        if (used != 0 && (uint8(table[want - 1]) >> used) != 0) revert InvalidTablePadding();
    }

    function _checkInfo(Challenge storage c, ICircuitsLite circuits, uint256 circuitId)
        private
        view
        returns (uint32 gateCount)
    {
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        (nIn, nOut, nState, gateCount) = circuits.circuitInfo(circuitId);
        if (nIn != c.nIn) revert InputCountMismatch(nIn, c.nIn);
        if (nOut != c.nOut) revert OutputCountMismatch(nOut, c.nOut);
        if (nState != 0) revert StatefulCircuit(nState);
        uint256 estimate = (uint256(1) << c.nIn) * (GAS_PER_EVAL_BASE + GAS_PER_GATE * uint256(gateCount));
        if (estimate > EVAL_GAS_BUDGET) revert CircuitTooExpensive(gateCount, estimate);
    }

    function _grade(uint256 id, Challenge storage c, ICircuitsLite circuits, uint256 circuitId) private view {
        bytes memory table = _tables[id];
        uint8 nOut = c.nOut;
        uint256 vectors = uint256(1) << c.nIn;
        uint8 mask = nOut == 8 ? type(uint8).max : uint8((1 << nOut) - 1);
        for (uint256 v; v < vectors; ++v) {
            // forge-lint: disable-next-line(unsafe-typecast)
            bytes memory out = circuits.eval(circuitId, abi.encodePacked(uint8(v)));
            if (out.length == 0) revert EmptyEvaluation(v);
            uint8 got = uint8(out[0]) & mask;
            uint8 want = _expected(table, v, nOut);
            if (got != want) revert TruthTableMismatch(v, got, want);
        }
    }

    function _expected(bytes memory table, uint256 vector, uint8 nOut) private pure returns (uint8 value) {
        uint256 start = vector * nOut;
        for (uint256 j; j < nOut; ++j) {
            uint256 p = start + j;
            uint8 bit = (uint8(table[p >> 3]) >> (p & 7)) & 1;
            value |= bit << j;
        }
    }

    function _updateBest(uint256 id, uint32 score, Commit storage m, uint256 circuitId) private returns (bool better) {
        Best storage b = _best[id];
        better = b.winner == address(0) || score < b.score
            || (score == b.score
                    && (m.blockNumber < b.commitBlock || (m.blockNumber == b.commitBlock && m.index < b.commitIndex)));
        if (better) {
            b.winner = msg.sender;
            b.score = score;
            b.commitIndex = m.index;
            b.commitBlock = m.blockNumber;
            b.circuitId = circuitId;
        }
    }
}

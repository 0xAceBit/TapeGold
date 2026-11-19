// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {ICircuitsLite, IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockProcessorRegistry} from "../mocks/MockProcessorRegistry.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockMaliciousCircuits} from "../mocks/MockMaliciousCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {FeeOnTransferERC20} from "../mocks/FeeOnTransferERC20.sol";

/// @dev TEST ONLY: token that refuses to deliver tokens to blacklisted recipients.
contract BlacklistERC20 is MockERC20 {
    mapping(address => bool) public blocked;

    function setBlocked(address a, bool b) external { blocked[a] = b; }

    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "blacklisted");
        super._update(from, to, amount);
    }
}

/// @dev TEST ONLY: token that, once armed, re-enters `target` with `attackData` on the next
/// transfer touching `target` and records the outcome without reverting.
contract ReentrantToken is MockERC20 {
    address public target;
    bytes public attackData;
    bool public armed;
    bool public attempted;
    bool public lastOk;
    bytes public lastRet;

    function arm(address t, bytes calldata d) external {
        target = t;
        attackData = d;
        armed = true;
        attempted = false;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (armed && (from == target || to == target)) {
            armed = false;
            attempted = true;
            (bool ok, bytes memory ret) = target.call(attackData);
            lastOk = ok;
            lastRet = ret;
        }
        super._update(from, to, amount);
    }
}

/// @dev TEST ONLY: circuits wrapper that, on every read TapeGolf performs, tries to re-enter
/// TapeGolf via STATICCALL (the only call kind a view function may make) and aborts if it works.
contract ReentrantCircuits is ICircuitsLite {
    MockCircuits public immutable inner;
    address public target;
    bytes public attackData;

    constructor() { inner = new MockCircuits(); }

    function setAttack(address t, bytes calldata d) external {
        target = t;
        attackData = d;
    }

    function tapeout(address owner, bytes calldata nl, uint32 nIn, uint32 nOut, uint32 nState, uint32 g, bytes calldata table)
        external returns (uint256)
    {
        return inner.tapeout(owner, nl, nIn, nOut, nState, g, table);
    }

    function _attack() private view {
        if (target != address(0)) {
            (bool ok,) = target.staticcall(attackData);
            require(!ok, "reentered");
        }
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory) {
        _attack();
        return inner.eval(id, inputs);
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        _attack();
        return inner.circuitInfo(id);
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        _attack();
        return inner.netlist(id);
    }

    function ownerOf(uint256 id) external view returns (address) {
        _attack();
        return inner.ownerOf(id);
    }
}

abstract contract TapeGolfBase is Test {
    uint16 internal constant FEE = 250;
    uint256 internal constant PRIZE = 1_000e6;
    bytes internal constant AND_TABLE = hex"00000001";

    TapeGolf internal golf;
    MockProcessorRegistry internal reg;
    MockCircuits internal cpu;
    MockCircuits internal cpu2;
    MockMaliciousCircuits internal evil;
    MockERC20 internal token;

    address internal sponsor = makeAddr("sponsor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal stranger = makeAddr("stranger");

    uint64 internal commitDeadline;
    uint64 internal revealDeadline;
    uint256 internal cid; // default contest, id 1

    function setUp() public virtual {
        vm.warp(1_000_000);
        reg = new MockProcessorRegistry();
        cpu = new MockCircuits();
        cpu2 = new MockCircuits();
        evil = new MockMaliciousCircuits();
        reg.setCpu(address(cpu), true);
        reg.setCpu(address(cpu2), true);
        golf = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, FEE);
        token = new MockERC20();
        commitDeadline = uint64(block.timestamp + 1 days);
        revealDeadline = commitDeadline + 1 days;
        _fund(token, golf);
        cid = _create(_params(token));
    }

    // ---------------------------------------------------------------- netlists

    function _nand(uint24 a, uint24 b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), a, b);
    }

    /// AND(in0,in1) = NAND followed by NAND(x,x). Wires: 0,1 inputs; gate k outputs wire 2+k.
    function _andNetlist() internal pure returns (bytes memory) {
        return bytes.concat(_nand(0, 1), _nand(2, 2));
    }

    /// XOR from four NAND gates.
    function _xorNetlist() internal pure returns (bytes memory) {
        return bytes.concat(_nand(0, 1), _nand(0, 2), _nand(1, 2), _nand(3, 4));
    }

    /// AND netlist padded with `gates - 2` dead NAND gates; `variant` varies the content (and hash).
    function _padded(uint256 gates, uint24 variant) internal pure returns (bytes memory nl) {
        nl = _andNetlist();
        for (uint256 i = 2; i < gates; ++i) {
            nl = bytes.concat(nl, _nand(variant % 4, (variant / 4) % 4));
        }
    }

    // ---------------------------------------------------------------- circuits / actions

    function _mintOn(MockCircuits c, address owner, bytes memory nl, bytes memory table) internal returns (uint256) {
        return c.tapeout(owner, nl, 2, 1, 0, uint32(nl.length / 7), table);
    }

    function _mint(address owner, bytes memory nl, bytes memory table) internal returns (uint256) {
        return _mintOn(cpu, owner, nl, table);
    }

    function _commit(uint256 c, address who, bytes memory nl, bytes32 salt) internal {
        bytes32 h = golf.commitmentOf(c, who, keccak256(nl), salt);
        vm.prank(who);
        golf.commit(c, h);
    }

    function _reveal(uint256 c, address who, address circuits, uint256 id, bytes32 salt) internal {
        vm.prank(who);
        golf.reveal(c, circuits, id, salt);
    }

    /// Mint an AND circuit of `gates` gates owned by `who`, and commit to it on contest `c`.
    function _enter(uint256 c, address who, uint256 gates, uint24 variant, bytes32 salt) internal returns (uint256 id) {
        bytes memory nl = _padded(gates, variant);
        id = _mint(who, nl, AND_TABLE);
        _commit(c, who, nl, salt);
    }

    function _toReveal() internal { vm.warp(commitDeadline); }

    function _toEnd() internal { vm.warp(revealDeadline); }

    // ---------------------------------------------------------------- contests

    function _params(IERC20 t) internal view returns (TapeGolf.CreateParams memory p) {
        p = TapeGolf.CreateParams({
            token: t,
            prize: PRIZE,
            processor: address(0),
            nIn: 2,
            nOut: 1,
            expected: AND_TABLE,
            maxGates: 20,
            maxNetlistBytes: 512,
            commitDeadline: commitDeadline,
            revealDeadline: revealDeadline
        });
    }

    function _create(TapeGolf.CreateParams memory p) internal returns (uint256) {
        vm.prank(sponsor);
        return golf.createContest(p);
    }

    function _fund(MockERC20 t, TapeGolf g) internal {
        t.mint(sponsor, 1e15);
        vm.prank(sponsor);
        t.approve(address(g), type(uint256).max);
    }

    function _balanceInvariantHolds(IERC20 t, address[] memory accts, uint256 unsettledPrizes) internal view returns (bool) {
        uint256 sum = unsettledPrizes;
        for (uint256 i; i < accts.length; ++i) sum += golf.pendingOf(t, accts[i]);
        return sum <= t.balanceOf(address(golf));
    }
}

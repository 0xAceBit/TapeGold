// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TapeGolf} from "../TapeGolf.sol";
import {IProcessorRegistry} from "../interfaces/ITapeOutLite.sol";
import {MockProcessorRegistry} from "../mocks/MockProcessorRegistry.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// Drives bounded random sequences of every user-facing action.
contract GolfHandler is Test {
    struct Entry {
        bool committed;
        bool revealed;
        uint256 circuitId;
        bytes32 salt;
    }

    TapeGolf public golf;
    MockERC20 public token;
    MockCircuits public cpu;
    address public sponsor;
    address public feeRecipient;
    address[3] public actors;
    uint256[] public contestIds;
    mapping(uint256 => mapping(address => Entry)) internal entries;
    bytes internal constant AND_TABLE = hex"00000001";

    constructor(TapeGolf g, MockERC20 t, MockCircuits c, address s, address f, address[3] memory a) {
        golf = g;
        token = t;
        cpu = c;
        sponsor = s;
        feeRecipient = f;
        actors = a;
    }

    function contestCount() external view returns (uint256) { return contestIds.length; }

    function accounts() public view returns (address[5] memory r) {
        r = [sponsor, feeRecipient, actors[0], actors[1], actors[2]];
    }

    function _netlist(uint256 gates) internal pure returns (bytes memory nl) {
        nl = bytes.concat(abi.encodePacked(uint8(0), uint24(0), uint24(1)), abi.encodePacked(uint8(0), uint24(2), uint24(2)));
        for (uint256 i = 2; i < gates; ++i) nl = bytes.concat(nl, abi.encodePacked(uint8(0), uint24(0), uint24(1)));
    }

    function _pick(uint256 seed) internal view returns (uint256 id, bool ok) {
        if (contestIds.length == 0) return (0, false);
        return (contestIds[seed % contestIds.length], true);
    }

    function createContest(uint256 prizeSeed, uint256 timeSeed) external {
        if (contestIds.length >= 6) return;
        uint256 prize = bound(prizeSeed, 1, 1e9);
        uint64 cd = uint64(block.timestamp + 1 hours + bound(timeSeed, 0, 2 hours));
        token.mint(sponsor, prize);
        vm.startPrank(sponsor);
        token.approve(address(golf), prize);
        uint256 id = golf.createContest(
            TapeGolf.CreateParams({
                token: token, prize: prize, processor: address(0), nIn: 2, nOut: 1, expected: AND_TABLE,
                maxGates: 12, maxNetlistBytes: 512, commitDeadline: cd, revealDeadline: cd + 1 hours
            })
        );
        vm.stopPrank();
        contestIds.push(id);
    }

    function commit(uint256 actorSeed, uint256 contestSeed, uint256 gatesSeed) external {
        (uint256 id, bool ok) = _pick(contestSeed);
        if (!ok) return;
        address who = actors[actorSeed % 3];
        if (golf.phaseOf(id) != TapeGolf.Phase.Commit || entries[id][who].committed) return;
        bytes memory nl = _netlist(bound(gatesSeed, 2, 12));
        uint256 cId = cpu.tapeout(who, nl, 2, 1, 0, uint32(nl.length / 7), AND_TABLE);
        bytes32 salt = keccak256(abi.encode(id, who, gatesSeed));
        entries[id][who] = Entry(true, false, cId, salt);
        vm.prank(who);
        golf.commit(id, golf.commitmentOf(id, who, keccak256(nl), salt));
    }

    function reveal(uint256 actorSeed, uint256 contestSeed) external {
        (uint256 id, bool ok) = _pick(contestSeed);
        if (!ok) return;
        address who = actors[actorSeed % 3];
        Entry storage e = entries[id][who];
        if (!e.committed || e.revealed || golf.phaseOf(id) != TapeGolf.Phase.Reveal) return;
        e.revealed = true;
        vm.prank(who);
        golf.reveal(id, address(cpu), e.circuitId, e.salt);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 90 minutes));
    }

    function settle(uint256 contestSeed, bool pay) external {
        (uint256 id, bool ok) = _pick(contestSeed);
        if (!ok || golf.phaseOf(id) != TapeGolf.Phase.Ended) return;
        if (pay) golf.settleAndPay(id);
        else golf.settle(id);
    }

    function claim(uint256 accountSeed, address caller) external {
        address a = accounts()[accountSeed % 5];
        if (golf.pendingOf(token, a) == 0) return;
        vm.prank(caller);
        golf.claim(token, a);
    }

    function unsettledPrizes() public view returns (uint256 sum) {
        for (uint256 i; i < contestIds.length; ++i) {
            TapeGolf.Contest memory c = golf.getContest(contestIds[i]);
            if (!c.settled) sum += c.prize;
        }
    }

    function pendingSum() public view returns (uint256 sum) {
        address[5] memory a = accounts();
        for (uint256 i; i < 5; ++i) sum += golf.pendingOf(token, a[i]);
    }
}

contract TapeGolfInvariantTest is Test {
    TapeGolf internal golf;
    MockERC20 internal token;
    GolfHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        MockProcessorRegistry reg = new MockProcessorRegistry();
        MockCircuits cpu = new MockCircuits();
        reg.setCpu(address(cpu), true);
        address feeRecipient = makeAddr("feeRecipient");
        golf = new TapeGolf(IProcessorRegistry(address(reg)), feeRecipient, 250);
        token = new MockERC20();
        address[3] memory actors = [makeAddr("alice"), makeAddr("bob"), makeAddr("carol")];
        handler = new GolfHandler(golf, token, cpu, makeAddr("sponsor"), feeRecipient, actors);

        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](6);
        sels[0] = GolfHandler.createContest.selector;
        sels[1] = GolfHandler.commit.selector;
        sels[2] = GolfHandler.reveal.selector;
        sels[3] = GolfHandler.warp.selector;
        sels[4] = GolfHandler.settle.selector;
        sels[5] = GolfHandler.claim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// Token balance always equals escrowed prizes of unsettled contests plus unclaimed credits:
    /// credits + escrow can never exceed (or fall short of) what the contract holds.
    function invariant_PendingPlusEscrowEqualsTokenBalance() public view {
        uint256 owed = handler.pendingSum() + handler.unsettledPrizes();
        assertEq(token.balanceOf(address(golf)), owed);
    }

    function invariant_PendingPlusEscrowNeverExceedsBalance() public view {
        assertLe(handler.pendingSum() + handler.unsettledPrizes(), token.balanceOf(address(golf)));
    }

    function invariant_SettledContestsAreNeverUnsettled() public view {
        for (uint256 i; i < handler.contestCount(); ++i) {
            uint256 id = handler.contestIds(i);
            TapeGolf.Phase ph = golf.phaseOf(id);
            if (golf.getContest(id).settled) assertEq(uint8(ph), uint8(TapeGolf.Phase.Settled));
        }
    }
}

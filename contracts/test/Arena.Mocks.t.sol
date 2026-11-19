// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../mocks/MockERC20.sol";
import {MockCircuits} from "../mocks/MockCircuits.sol";

/// @dev TEST ONLY: token that refuses to deliver tokens to blacklisted recipients.
contract BlacklistERC20 is MockERC20 {
    mapping(address => bool) public blocked;

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "blacklisted");
        super._update(from, to, amount);
    }
}

/// @dev TEST ONLY: once armed, re-enters `target` with `attackData` on the next transfer touching `target`,
/// records the outcome and does not revert.
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
        lastOk = false;
        delete lastRet;
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

/// @dev TEST ONLY: token whose 1% transfer fee can be switched on after a challenge was created.
contract ToggleFeeERC20 is MockERC20 {
    bool public feeOn;

    function setFeeOn(bool b) external {
        feeOn = b;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (feeOn && from != address(0) && to != address(0)) {
            uint256 fee = amount / 100;
            if (fee != 0) super._update(from, address(0), fee);
            super._update(from, to, amount - fee);
        } else {
            super._update(from, to, amount);
        }
    }
}

interface IHook {
    function onTokenReceived(address from, uint256 amount) external;
}

/// @dev TEST ONLY: ERC-777 style token that calls `onTokenReceived` on hooked recipients after they are credited.
contract HookERC20 is MockERC20 {
    mapping(address => bool) public hooked;

    function setHooked(address a, bool b) external {
        hooked[a] = b;
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (hooked[to] && from != address(0)) IHook(to).onTokenReceived(from, amount);
    }
}

/// @dev TEST ONLY: contract account. Mode 0 ignores the hook, 1 re-enters `target` with `data` from the hook,
/// 2 reverts in the hook. `exec` lets the test act as this contract (circuit owner, committer, winner).
contract HookRecipient is IHook {
    uint8 public mode;
    address public target;
    bytes public data;
    bool public attempted;
    bool public lastOk;
    bytes public lastRet;

    function configure(uint8 m, address t, bytes calldata d) external {
        mode = m;
        target = t;
        data = d;
        attempted = false;
        lastOk = false;
        delete lastRet;
    }

    function onTokenReceived(address, uint256) external override {
        if (mode == 2) revert("receiver rejects");
        if (mode == 1 && !attempted) {
            attempted = true;
            (lastOk, lastRet) = target.call(data);
        }
    }

    function exec(address t, bytes calldata d) external returns (bytes memory r) {
        bool ok;
        (ok, r) = t.call(d);
        if (!ok) {
            assembly {
                revert(add(r, 32), mload(r))
            }
        }
    }
}

/// @dev TEST ONLY: processor wrapper. Functions are deliberately non-view (Arena reaches them by STATICCALL anyway).
/// Per-circuit eval modes: 0 honest, 1 spin forever, 2 burn gas down to `burnLeave` then answer honestly,
/// 3 return a `blobSize` byte blob, 4 return empty bytes. It can also re-enter a target from any read.
contract WrapProcessor {
    MockCircuits public immutable inner;
    mapping(uint256 => uint8) public evalMode;
    uint256 public burnLeave = 1000;
    uint256 public blobSize = 3_600_000;

    address public target;
    bytes public data;
    uint8 public mask; // 1 eval, 2 ownerOf, 4 circuitInfo
    bool public bubble;

    constructor() {
        inner = new MockCircuits();
    }

    function tapeout(
        address who,
        bytes calldata nl,
        uint32 nIn,
        uint32 nOut,
        uint32 nState,
        uint32 gateCount,
        bytes calldata table
    ) external returns (uint256) {
        return inner.tapeout(who, nl, nIn, nOut, nState, gateCount, table);
    }

    function setEvalMode(uint256 id, uint8 m) external {
        evalMode[id] = m;
    }

    function setBurnLeave(uint256 n) external {
        burnLeave = n;
    }

    function setBlobSize(uint256 n) external {
        blobSize = n;
    }

    function setAttack(address t, bytes calldata d, uint8 m, bool b) external {
        target = t;
        data = d;
        mask = m;
        bubble = b;
    }

    function _attack(uint8 which) private {
        if (target != address(0) && (mask & which) != 0) {
            (bool ok, bytes memory r) = target.call(data);
            if (ok) revert("reentered");
            if (bubble) {
                assembly {
                    revert(add(r, 32), mload(r))
                }
            }
        }
    }

    function eval(uint256 id, bytes calldata inputs) external returns (bytes memory) {
        _attack(1);
        uint8 m = evalMode[id];
        if (m == 1) {
            while (true) {}
        }
        if (m == 2) {
            while (gasleft() > burnLeave) {}
        }
        if (m == 3) return new bytes(blobSize);
        if (m == 4) return "";
        return inner.eval(id, inputs);
    }

    function circuitInfo(uint256 id) external returns (uint32, uint32, uint32, uint32) {
        _attack(4);
        return inner.circuitInfo(id);
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        return inner.netlist(id);
    }

    function ownerOf(uint256 id) external returns (address) {
        _attack(2);
        return inner.ownerOf(id);
    }
}

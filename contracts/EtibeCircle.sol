// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EtibeCircle
 * @notice Manages a rotating savings circle (tontine) on Base.
 *         The backend's master wallet is the contract owner and orchestrates
 *         member management, round progression, and payout releases.
 *         Supports both native ETH and ERC-20 tokens (cNGN, USDC).
 *         tokenAddress == address(0) means ETH mode.
 */
contract EtibeCircle is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct MemberInfo {
        uint256 position;
        bool isActive;
        bool hasReceivedPayout;
        uint256 contributedRounds;
    }

    struct CircleState {
        string name;
        address creator;
        address tokenAddress;
        uint256 contributionAmount;
        uint256 maxMembers;
        uint256 currentRound;
        uint256 totalRounds;
        bool isActive;
        uint256 memberCount;
    }

    // --- Circle configuration (set once) ---
    string public name;
    address public creator;
    address public tokenAddress; // address(0) = ETH mode
    uint256 public contributionAmount;
    uint256 public maxMembers;
    uint256 public gracePeriodDays;

    // --- Round state ---
    uint256 public currentRound;
    uint256 public totalRounds;
    bool public isActive;

    // --- Members ---
    address[] public memberList;
    mapping(address => MemberInfo) public members;
    mapping(address => bool) public isMember;

    // --- Payout order ---
    address[] public payoutOrder;

    // --- Contributions: round => member => contributed ---
    mapping(uint256 => mapping(address => bool)) public roundContributions;
    mapping(uint256 => uint256) public roundContributionCount;

    // --- Events ---
    event CircleInitialized(string name, address creator, uint256 contributionAmount);
    event MemberAdded(address indexed member, uint256 position);
    event ContributionReceived(address indexed from, uint256 round, uint256 amount);
    event PayoutReleased(address indexed to, uint256 round, uint256 amount);
    event CircleCompleted();
    event CircleStarted(uint256 totalRounds);

    constructor(
        string memory _name,
        address _creator,
        address _tokenAddress,
        uint256 _contributionAmount,
        uint256 _maxMembers,
        uint256 _gracePeriodDays
    ) Ownable(msg.sender) {
        require(_maxMembers >= 2 && _maxMembers <= 50, "Invalid max members");
        require(_contributionAmount > 0, "Contribution must be > 0");

        name = _name;
        creator = _creator;
        tokenAddress = _tokenAddress;
        contributionAmount = _contributionAmount;
        maxMembers = _maxMembers;
        gracePeriodDays = _gracePeriodDays;
        currentRound = 0;
        totalRounds = 0;
        isActive = false;

        emit CircleInitialized(_name, _creator, _contributionAmount);
    }

    // --- Owner-only management functions ---

    function addMember(address _member, uint256 _position) external onlyOwner {
        require(!isActive, "Circle already active");
        require(!isMember[_member], "Already a member");
        require(memberList.length < maxMembers, "Circle is full");

        members[_member] = MemberInfo({
            position: _position,
            isActive: true,
            hasReceivedPayout: false,
            contributedRounds: 0
        });
        isMember[_member] = true;
        memberList.push(_member);

        emit MemberAdded(_member, _position);
    }

    function setPayoutOrder(address[] calldata _order) external onlyOwner {
        require(!isActive, "Circle already active");
        require(_order.length == memberList.length, "Order must match member count");

        for (uint256 i = 0; i < _order.length; i++) {
            require(isMember[_order[i]], "Address not a member");
        }

        payoutOrder = _order;
    }

    function startCircle() external onlyOwner {
        require(!isActive, "Already active");
        require(memberList.length >= 2, "Need at least 2 members");
        require(payoutOrder.length == memberList.length, "Payout order not set");

        isActive = true;
        currentRound = 1;
        totalRounds = memberList.length;

        emit CircleStarted(totalRounds);
    }

    // --- Contribution functions ---

    function contributeETH() external payable nonReentrant {
        require(isActive, "Circle not active");
        require(tokenAddress == address(0), "Not an ETH circle");
        require(isMember[msg.sender], "Not a member");
        require(!roundContributions[currentRound][msg.sender], "Already contributed this round");
        require(msg.value == contributionAmount, "Incorrect amount");

        roundContributions[currentRound][msg.sender] = true;
        roundContributionCount[currentRound]++;
        members[msg.sender].contributedRounds++;

        emit ContributionReceived(msg.sender, currentRound, msg.value);
    }

    function contributeToken(uint256 amount) external nonReentrant {
        require(isActive, "Circle not active");
        require(tokenAddress != address(0), "Not a token circle");
        require(isMember[msg.sender], "Not a member");
        require(!roundContributions[currentRound][msg.sender], "Already contributed this round");
        require(amount == contributionAmount, "Incorrect amount");

        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);

        roundContributions[currentRound][msg.sender] = true;
        roundContributionCount[currentRound]++;
        members[msg.sender].contributedRounds++;

        emit ContributionReceived(msg.sender, currentRound, amount);
    }

    // --- Payout (owner-triggered) ---

    function releasePayout() external onlyOwner nonReentrant {
        require(isActive, "Circle not active");
        require(currentRound <= totalRounds, "All rounds complete");

        address recipient = payoutOrder[currentRound - 1];
        require(!members[recipient].hasReceivedPayout, "Already received payout");

        uint256 payoutAmount = contributionAmount * memberList.length;

        if (tokenAddress == address(0)) {
            require(address(this).balance >= payoutAmount, "Insufficient ETH balance");
            (bool success, ) = payable(recipient).call{value: payoutAmount}("");
            require(success, "ETH transfer failed");
        } else {
            uint256 tokenBalance = IERC20(tokenAddress).balanceOf(address(this));
            require(tokenBalance >= payoutAmount, "Insufficient token balance");
            IERC20(tokenAddress).safeTransfer(recipient, payoutAmount);
        }

        members[recipient].hasReceivedPayout = true;

        emit PayoutReleased(recipient, currentRound, payoutAmount);

        if (currentRound == totalRounds) {
            isActive = false;
            emit CircleCompleted();
        } else {
            currentRound++;
        }
    }

    // --- Emergency ---

    function emergencyWithdraw(address to) external onlyOwner {
        if (tokenAddress == address(0)) {
            uint256 balance = address(this).balance;
            if (balance > 0) {
                (bool success, ) = payable(to).call{value: balance}("");
                require(success, "ETH transfer failed");
            }
        } else {
            uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
            if (balance > 0) {
                IERC20(tokenAddress).safeTransfer(to, balance);
            }
        }
    }

    // --- View functions ---

    function getCircleState() external view returns (CircleState memory) {
        return CircleState({
            name: name,
            creator: creator,
            tokenAddress: tokenAddress,
            contributionAmount: contributionAmount,
            maxMembers: maxMembers,
            currentRound: currentRound,
            totalRounds: totalRounds,
            isActive: isActive,
            memberCount: memberList.length
        });
    }

    function getMemberContribution(address member, uint256 round) external view returns (bool) {
        return roundContributions[round][member];
    }

    function getRoundProgress(uint256 round) external view returns (uint256 contributed, uint256 total) {
        return (roundContributionCount[round], memberList.length);
    }

    function getMemberCount() external view returns (uint256) {
        return memberList.length;
    }

    function getPayoutRecipient(uint256 round) external view returns (address) {
        require(round >= 1 && round <= payoutOrder.length, "Invalid round");
        return payoutOrder[round - 1];
    }

    // Allow the contract to receive ETH
    receive() external payable {}
}

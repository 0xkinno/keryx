// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title KeryxSplits
/// @notice A fully self-contained, on-chain work catalog and citation
///         settlement contract. Every work's title, URL, price, and
///         recipient splits live entirely on-chain — no off-chain index is
///         required for anyone to discover, verify, or pay for a work.
/// @dev Self-contained, no external imports, to avoid Remix import-fetch issues.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract KeryxSplits {
    IERC20 public immutable usdc;

    address public owner;
    address public agent;

    bool private locked;

    uint16 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_RECIPIENTS = 10;
    uint256 public constant MAX_STRING_LEN = 300;

    struct Work {
        string title;
        string url;
        address[] recipients;
        uint16[] bps;
        uint256 pricePerCitation; // USDC units, 6 decimals
        uint256 citationCount;
        bool exists;
    }

    mapping(string => Work) private works;
    mapping(address => uint256) public balances;

    /// @notice Every workId ever registered, in registration order.
    ///         Anyone can enumerate the full catalog directly from the
    ///         chain via workCount() + getWorkIdsPage(), with no reliance
    ///         on any off-chain index.
    string[] private allWorkIds;

    event WorkRegistered(string indexed workId, string title, string url, address[] recipients, uint16[] bps, uint256 price);
    event PriceUpdated(string indexed workId, uint256 oldPrice, uint256 newPrice);
    event CitationSettled(string indexed workId, address indexed reader, uint256 amount, uint256 timestamp);
    event RecipientCredited(string indexed workId, address indexed recipient, uint256 amount);
    event AnswerSettled(address indexed reader, uint256 workCount, uint256 totalAmount, uint256 timestamp);
    event Withdrawn(address indexed writer, uint256 amount);
    event AgentUpdated(address indexed newAgent);

    modifier onlyOwner() {
        require(msg.sender == owner, "KeryxSplits: caller is not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent || msg.sender == owner, "KeryxSplits: caller is not agent");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "KeryxSplits: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _usdc, address _agent) {
        require(_usdc != address(0), "KeryxSplits: USDC address required");
        usdc = IERC20(_usdc);
        agent = _agent;
        owner = msg.sender;
    }

    /// @notice Owner can rotate the backend agent wallet if it's ever compromised or redeployed.
    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "KeryxSplits: zero address");
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    /// @notice Register a work with its title, source URL, and one or more
    ///         recipients sharing revenue by basis points (10000 = 100%).
    ///         For a single author, pass recipients = [yourAddress], bps = [10000].
    ///         Title and URL are stored fully on-chain, so any wallet can
    ///         discover and display this work with no external database.
    /// @dev The caller must be one of the listed recipients, so a listing is
    ///      always tied to a real signer with a stake in it.
    function registerWork(
        string calldata workId,
        string calldata title,
        string calldata url,
        address[] calldata recipients,
        uint16[] calldata bps,
        uint256 pricePerCitation
    ) external {
        require(!works[workId].exists, "KeryxSplits: work already registered");
        require(pricePerCitation > 0, "KeryxSplits: price must be > 0");
        require(bytes(title).length > 0, "KeryxSplits: title required");
        require(bytes(title).length <= MAX_STRING_LEN, "KeryxSplits: title too long");
        require(bytes(url).length <= MAX_STRING_LEN, "KeryxSplits: url too long");
        require(recipients.length > 0, "KeryxSplits: at least one recipient required");
        require(recipients.length == bps.length, "KeryxSplits: recipients/bps length mismatch");
        require(recipients.length <= MAX_RECIPIENTS, "KeryxSplits: too many recipients");

        uint256 total = 0;
        bool callerIsRecipient = false;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "KeryxSplits: zero address recipient");
            require(bps[i] > 0, "KeryxSplits: bps must be > 0");
            total += bps[i];
            if (recipients[i] == msg.sender) callerIsRecipient = true;
        }
        require(total == BPS_DENOMINATOR, "KeryxSplits: bps must sum to 10000");
        require(callerIsRecipient, "KeryxSplits: caller must be one of the recipients");

        works[workId] = Work({
            title: title,
            url: url,
            recipients: recipients,
            bps: bps,
            pricePerCitation: pricePerCitation,
            citationCount: 0,
            exists: true
        });

        allWorkIds.push(workId);

        emit WorkRegistered(workId, title, url, recipients, bps, pricePerCitation);
    }

    /// @notice The first-listed recipient (the primary registrant) may update
    ///         the price. Kept single-signer to avoid needing on-chain
    ///         co-author governance for a simple price change.
    function updatePrice(string calldata workId, uint256 newPrice) external {
        Work storage w = works[workId];
        require(w.exists, "KeryxSplits: work not registered");
        require(newPrice > 0, "KeryxSplits: price must be > 0");
        require(w.recipients.length > 0 && w.recipients[0] == msg.sender, "KeryxSplits: only the primary recipient may update price");
        uint256 old = w.pricePerCitation;
        w.pricePerCitation = newPrice;
        emit PriceUpdated(workId, old, newPrice);
    }

    /// @notice Settle a single citation. Splits `amount` across the work's
    ///         recipients by their registered basis points.
    function settleCitation(string calldata workId, address reader, uint256 amount) external onlyAgent nonReentrant {
        _settleOne(workId, reader, amount);
        emit AnswerSettled(reader, 1, amount, block.timestamp);
    }

    /// @notice Settle every citation for one answer in a single transaction.
    ///         workIds[i] is paid amounts[i], split per that work's recipients.
    function settleAnswer(
        string[] calldata workIds,
        address reader,
        uint256[] calldata amounts
    ) external onlyAgent nonReentrant {
        require(workIds.length == amounts.length, "KeryxSplits: workIds/amounts length mismatch");
        require(workIds.length > 0, "KeryxSplits: nothing to settle");

        uint256 total = 0;
        for (uint256 i = 0; i < workIds.length; i++) {
            _settleOne(workIds[i], reader, amounts[i]);
            total += amounts[i];
        }
        emit AnswerSettled(reader, workIds.length, total, block.timestamp);
    }

    function _settleOne(string calldata workId, address reader, uint256 amount) internal {
        Work storage w = works[workId];
        require(w.exists, "KeryxSplits: work not registered");
        require(amount > 0, "KeryxSplits: amount must be > 0");
        require(reader != address(0), "KeryxSplits: invalid reader");

        bool ok = usdc.transferFrom(reader, address(this), amount);
        require(ok, "KeryxSplits: USDC transferFrom failed");

        uint256 distributed = 0;
        uint256 n = w.recipients.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 share;
            if (i == n - 1) {
                // Last recipient absorbs any rounding remainder so the full
                // amount is always fully distributed, never stranded by
                // integer division.
                share = amount - distributed;
            } else {
                share = (amount * w.bps[i]) / BPS_DENOMINATOR;
                distributed += share;
            }
            balances[w.recipients[i]] += share;
            emit RecipientCredited(workId, w.recipients[i], share);
        }

        w.citationCount += 1;
        emit CitationSettled(workId, reader, amount, block.timestamp);
    }

    /// @notice A recipient withdraws their full accumulated balance.
    function withdraw() external nonReentrant {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "KeryxSplits: nothing to withdraw");
        balances[msg.sender] = 0;
        bool ok = usdc.transfer(msg.sender, bal);
        require(ok, "KeryxSplits: USDC transfer failed");
        emit Withdrawn(msg.sender, bal);
    }

    function balanceOf(address writer) external view returns (uint256) {
        return balances[writer];
    }

    /// @notice Real, on-chain citation count for a work.
    function citationsOf(string calldata workId) external view returns (uint256) {
        return works[workId].citationCount;
    }

    /// @notice Total number of works ever registered. Use with
    ///         getWorkIdsPage() to enumerate the full catalog.
    function workCount() external view returns (uint256) {
        return allWorkIds.length;
    }

    /// @notice Returns a page of workIds, in registration order, so the full
    ///         catalog can be browsed directly from the chain without any
    ///         off-chain index. Call getWork(id) on each returned id for
    ///         its full details.
    function getWorkIdsPage(uint256 offset, uint256 limit) external view returns (string[] memory) {
        uint256 total = allWorkIds.length;
        if (offset >= total) {
            return new string[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        string[] memory page = new string[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = allWorkIds[i];
        }
        return page;
    }

    function getWork(string calldata workId) external view returns (
        string memory title,
        string memory url,
        address[] memory recipients,
        uint16[] memory bps,
        uint256 price,
        uint256 citationCount,
        bool exists
    ) {
        Work storage w = works[workId];
        return (w.title, w.url, w.recipients, w.bps, w.pricePerCitation, w.citationCount, w.exists);
    }
}

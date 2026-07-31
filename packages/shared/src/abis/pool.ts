import { parseAbi } from 'viem'

// Verbatim v3 Pool interface fragments (aave-v3-origin v3.6.0 IPool.sol; identical on v3.7).
// NOTE: the Borrow event's interestRateMode is a Solidity enum -> hashes as uint8.
export const POOL_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function setUserEMode(uint8 categoryId)',
  'function multicall(bytes[] data) returns (bytes[] results)',
  'function POOL_REVISION() view returns (uint256)',
  'function getReserveAddressById(uint16 id) view returns (address)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)',
  'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)',
  'event ReserveUsedAsCollateralEnabled(address indexed reserve, address indexed user)',
  'event ReserveUsedAsCollateralDisabled(address indexed reserve, address indexed user)',
  'event UserEModeSet(address indexed user, uint8 categoryId)',
  'event ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex)',
])

export type PoolAbiEvent = Extract<(typeof POOL_ABI)[number], { type: 'event' }>

export const POOL_EVENT_DEFS: readonly PoolAbiEvent[] = POOL_ABI.filter(
  (item): item is PoolAbiEvent => item.type === 'event',
)

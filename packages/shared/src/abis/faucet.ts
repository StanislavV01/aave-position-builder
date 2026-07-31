import { parseAbi } from 'viem'

// Aave testnet Faucet (unpermissioned on Base Sepolia): mints test tokens to any address.
export const FAUCET_ABI = parseAbi([
  'function mint(address token, address to, uint256 amount) returns (uint256)',
])

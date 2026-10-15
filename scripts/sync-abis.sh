#!/bin/bash
# Copy the contract ABIs from the FairProp monorepo (generated there by contracts/export-abis.sh).
# Run after a contract redeploy, together with an address update in src/networks.ts.
set -e
SRC=${1:-../fairprop/frontend/src/lib/contracts/abis}
for c in ChallengeFactoryTestnet ChallengeFactoryMainnet SimulationEngineTestnet SimulationEngineMainnet VaultManagerTestnet VaultManagerMainnet; do
  cp "$SRC/$c.ts" "src/abis/$c.ts"
done
echo "ABIs synced from $SRC"

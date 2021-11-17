# Drifting Mango

*please use caution and burner wallets when using this experimental software*

# What is it

The program looks at Mango SOL-PERP price and Drift SOL-PERP price. 

Once the gap becomes wide enough, it opens a postion on both side to close the gap.

For example if Mango is selling at 260 and Drift is selling at 230, it will open Mango market short and Drift market long (in one transaction!).

# Pre-requisite

1. You will need Drift Alpha access
2. Import your Drift Alpha access's wallet private key into Phantom. You can paste the whole array in as private key.
3. Deposit USDC into Drift via UI
4. Create new Mango Account in the same wallet via UI
5. Deposit same amount of money into Mango
6. Adjust POSITION_SIZE_USD, MAX_POSITION_SIZE.
7. Enjoy 

Quick Start
----
```
yarn
ts-node src/drifting-mango.ts
```

# Disclaimer

NFA, everything is written as an experiment, please don't put more than couple hundred bucks into it.

It also has no liquidation preventive measure, you will get liquidated.

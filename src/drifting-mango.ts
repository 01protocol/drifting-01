import { BN, Provider, Wallet } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
    calculateMarkPrice,
    ClearingHouse,
    initialize,
    Markets,
    PositionDirection,
    convertToNumber,
    calculateTradeSlippage,
    MARK_PRICE_PRECISION,
    QUOTE_PRECISION,
    DriftEnv, ClearingHouseUser,
} from '@drift-labs/sdk';
import MangoArbClient from "./mango";
import {wrapInTx} from "@drift-labs/sdk/lib/tx/utils";


require('dotenv').config();

// % differences between markets to initiate a position.
// higher is likely more profitable but less opportunities
// at drift long it's comparing to (mango short price - drift long price) / drift long price * 100
// at rift short it's comparing (drift short price - mango long price) / mango long price * 100
// TODO: MAKE IT DYNAMIC
const THRESHOLD = 0.44444;

// size for each position, there could be multiple positions until price is within threshold
const POSITION_SIZE_USD = 100;

// Max position size before going reduce only mode (+/- POSITION_SIZE_USD)
const MAX_POSITION_SIZE = 3000;

// Private key array
// Please read from file system or environment...
// Also have it setup & deposit money into it via Phantom.
// You can import the array into Phantom as private key string.
const PRIVATE_KEY = '[0,0,0....]'

// RPC address, please don't use public ones.
const RPC_ADDRESS = ''

const main = async () => {
    const sdkConfig = initialize({ env: 'mainnet-beta' as DriftEnv });

    // Set up the Wallet and Provider
    const privateKey = PRIVATE_KEY
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    const wallet = new Wallet(keypair);

    // Set up the Connection
    const connection = new Connection(RPC_ADDRESS);

    // Set up the Provider
    const provider = new Provider(connection, wallet, Provider.defaultOptions());

    // Set up Mango
    const mangoArbClient = new MangoArbClient(RPC_ADDRESS)
    await mangoArbClient.init(JSON.parse(privateKey))


    // Set up the Drift Clearing House
    const clearingHousePublicKey = new PublicKey(
        sdkConfig.CLEARING_HOUSE_PROGRAM_ID
    );

    const clearingHouse = ClearingHouse.from(
        connection,
        provider.wallet,
        clearingHousePublicKey
    );

    await clearingHouse.subscribe();

    const solMarketInfo = Markets.find(
        (market) => market.baseAssetSymbol === 'SOL'
    );
    const solMarketAccount = clearingHouse.getMarket(solMarketInfo.marketIndex);

    // set up drift user
    // Set up Clearing House user client
    const user = ClearingHouseUser.from(clearingHouse, wallet.publicKey);
    await user.subscribe();


    let priceInfo = {
        longEntry: 0,
        shortEntry: 0
    }

    clearingHouse.eventEmitter.addListener('marketsAccountUpdate', async (d) => {
        const formattedPrice = convertToNumber(calculateMarkPrice(d['markets'][0]), MARK_PRICE_PRECISION);

        let longSlippage = convertToNumber(
            calculateTradeSlippage(
                PositionDirection.LONG,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketAccount
            )[0],
            MARK_PRICE_PRECISION
        );

        let shortSlippage = convertToNumber(
            calculateTradeSlippage(
                PositionDirection.SHORT,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketAccount
            )[0],
            MARK_PRICE_PRECISION
        );

        priceInfo.longEntry = formattedPrice * (1 + longSlippage )
        priceInfo.shortEntry = formattedPrice * (1 - shortSlippage )
    })

    async function canOpenDriftShort() {
        return (convertToNumber(user.getPositionValue(solMarketInfo.marketIndex), QUOTE_PRECISION) > -1 * MAX_POSITION_SIZE)
    }

    async function canOpenDriftLong() {
        return (convertToNumber(user.getPositionValue(solMarketInfo.marketIndex), QUOTE_PRECISION) < MAX_POSITION_SIZE)
    }


    async function mainLoop() {
        if (!priceInfo.shortEntry || ! priceInfo.longEntry) {
            return
        }

        const mangoBid = await mangoArbClient.getTopAsk()
        const mangoAsk = await mangoArbClient.getTopBid()

        const driftShortDiff = (priceInfo.shortEntry - mangoAsk) / mangoAsk * 100
        const driftLongDiff = (mangoBid - priceInfo.longEntry) / priceInfo.longEntry * 100
        console.log(`Buy Drift Sell Mango Diff: ${driftShortDiff.toFixed(4)}%. // Buy Mango Sell Drift Diff: ${driftLongDiff.toFixed(4)}%.`)


        // open drift long mango short
        if (driftLongDiff > THRESHOLD) {
            if (!await canOpenDriftLong()) {
                console.log(`Letting this opportunity go due to Drift long exposure is > ${MAX_POSITION_SIZE}`)
            }
            console.log("====================================================================")
            console.log(`SELL $100 worth of SOL on Mango at price ~${mangoBid}`);
            console.log(`LONG $100 worth of SOL on Drift at price ~${priceInfo.longEntry}`);
            console.log(`Capturing ~${driftLongDiff.toFixed(4)}% profit (Mango fees & slippage not included)`);

            const txn = wrapInTx(await clearingHouse.getOpenPositionIx(
                PositionDirection.LONG,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketInfo.marketIndex
            ));

            txn.add(mangoArbClient.marketShort(POSITION_SIZE_USD, mangoAsk))
            await clearingHouse.txSender.send(txn, [], clearingHouse.opts).catch(t => {
                console.log("Transaction didn't go through, may due to low balance...", t)
            });
        }

        // open mango short drift long
        if (driftShortDiff > THRESHOLD) {
            if (!await canOpenDriftShort()) {
                console.log(`Letting this opportunity go due to Drift short exposure is < ${MAX_POSITION_SIZE}`)
            }

            console.log("====================================================================")
            console.log(`SELL $100 worth of SOL on Drift at price ~${priceInfo.shortEntry}`);
            console.log(`LONG $100 worth of SOL on Drift at price ~${mangoAsk}`);
            console.log(`Capturing ~${driftShortDiff.toFixed(4)}% profit (Mango fees & slippage not included)`);

            const txn = wrapInTx(await clearingHouse.getOpenPositionIx(
                PositionDirection.SHORT,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketInfo.marketIndex
            ));
            txn.add(mangoArbClient.marketLong(POSITION_SIZE_USD, mangoAsk))
            await clearingHouse.txSender.send(txn, [], clearingHouse.opts).catch(t => {
                console.log("Transaction didn't go through, may due to low balance...", t)
            });
        }
    }
    setInterval(mainLoop, 4000)
}
main()

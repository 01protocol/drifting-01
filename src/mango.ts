import {
    Config,
    getMarketByBaseSymbolAndKind,
    GroupConfig,
    makePlacePerpOrderInstruction,
    MangoAccount,
    MangoCache,
    MangoClient,
    MangoGroup,
    PerpMarket
} from '@blockworks-foundation/mango-client';
import {BN} from '@drift-labs/sdk';
import {Account, Connection, PublicKey} from "@solana/web3.js";
import configFile from './ids.json';
import {RestClient} from 'ftx-api'

export default class MangoArbClient {
    solPerpMarket: PerpMarket;
    connection: Connection;
    groupConfig: GroupConfig;
    client: MangoClient;
    mangoAccount: MangoAccount;
    mangoGroup: MangoGroup;
    owner: Account;
    solMarketIndex: number
    ftx: RestClient;
    btcPerpMarket: PerpMarket;
    ethPerpMarket: PerpMarket;
    btcMarketIndex: number;
    ethMarketIndex: number;

    constructor(url: string) {
        const config = new Config(configFile);
        this.groupConfig = config.getGroup(
            'mainnet',
            'mainnet.1',
        ) as GroupConfig;

        this.connection = new Connection(url, {commitment: 'processed'});

        this.ftx = new RestClient(process.env['FTX_API_KEY'], process.env['FTX_API_SECRET'], {
            subAccountName: 'mango-hedge',
        })

    }

    async init(privateKey) {
        this.client = new MangoClient(this.connection, this.groupConfig.mangoProgramId);
        // load group & market
        const solPerpMarketConfig = getMarketByBaseSymbolAndKind(
            this.groupConfig,
            'SOL',
            'perp',
        );
        const btcPerpMarketConfig = getMarketByBaseSymbolAndKind(
            this.groupConfig,
            'BTC',
            'perp',
        );
        const ethPerpMarketConfig = getMarketByBaseSymbolAndKind(
            this.groupConfig,
            'ETH',
            'perp',
        );

        this.solMarketIndex = solPerpMarketConfig.marketIndex;
        this.btcMarketIndex = btcPerpMarketConfig.marketIndex;
        this.ethMarketIndex = ethPerpMarketConfig.marketIndex;
        this.mangoGroup = await this.client.getMangoGroup(this.groupConfig.publicKey);

        this.solPerpMarket = await this.mangoGroup.loadPerpMarket(
            this.connection,
            solPerpMarketConfig.marketIndex,
            solPerpMarketConfig.baseDecimals,
            solPerpMarketConfig.quoteDecimals,
        );

        this.btcPerpMarket = await this.mangoGroup.loadPerpMarket(
            this.connection,
            btcPerpMarketConfig.marketIndex,
            btcPerpMarketConfig.baseDecimals,
            btcPerpMarketConfig.quoteDecimals,
        )
        this.ethPerpMarket = await this.mangoGroup.loadPerpMarket(
            this.connection,
            ethPerpMarketConfig.marketIndex,
            ethPerpMarketConfig.baseDecimals,
            ethPerpMarketConfig.quoteDecimals,
        )


        this.owner = new Account(Uint8Array.from(privateKey));
        this.mangoAccount = (
            await this.client.getMangoAccountsForOwner(this.mangoGroup, this.owner.publicKey)
        )[0];
    }

    async refresh() {
        this.mangoAccount = (
            await this.client.getMangoAccountsForOwner(this.mangoGroup, this.owner.publicKey)
        )[0];
    }


    async getTopBid() {
        let bids = await this.solPerpMarket.loadBids(this.connection);
        return bids.getL2(1)[0][0]
    }

    async getTopAsk() {
        let asks = await this.solPerpMarket.loadAsks(this.connection);
        return asks.getL2(1)[0][0]
    }

    async getPositions() {
        await this.refresh()

        const SOL = this.mangoAccount.getPerpPositionUi(this.solMarketIndex, this.solPerpMarket)
        const ETH = this.mangoAccount.getPerpPositionUi(this.ethMarketIndex, this.ethPerpMarket)
        const BTC = this.mangoAccount.getPerpPositionUi(this.btcMarketIndex, this.btcPerpMarket)
        return {
            SOL, ETH, BTC
        }
    }

    async getAccountValue() {
        let cache = await this.mangoGroup.loadCache(this.connection);

        const asset = (this.mangoAccount.getAssetsVal(this.mangoGroup, cache).toNumber())
        const liability = (this.mangoAccount.getLiabsVal(this.mangoGroup, cache).toNumber())
        return asset - liability
    }

    marketLong(usdAmount, topAsk, quantity) {
        const [nativePrice, nativeQuantity] = this.solPerpMarket.uiToNativePriceQuantity(
            topAsk,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.solPerpMarket.publicKey,
            this.solPerpMarket.bids,
            this.solPerpMarket.asks,
            this.solPerpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'buy', // or 'sell'
            'market',
        )
    }

    marketShort(usdAmount, topBid, quantity) {
        const [nativePrice, nativeQuantity] = this.solPerpMarket.uiToNativePriceQuantity(
            topBid,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.solPerpMarket.publicKey,
            this.solPerpMarket.bids,
            this.solPerpMarket.asks,
            this.solPerpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'sell', // or 'sell'
            'market',
        )
    }
}


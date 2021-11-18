import {
    Config,
    getMarketByBaseSymbolAndKind,
    GroupConfig,
    makePlacePerpOrderInstruction,
    MangoAccount,
    MangoClient,
    MangoGroup,
    PerpMarket
} from '@blockworks-foundation/mango-client';
import {BN} from '@drift-labs/sdk';
import {Account, Connection} from "@solana/web3.js";
import configFile from './ids.json';

export default class MangoArbClient {
    perpMarket: PerpMarket;
    connection: Connection;
    groupConfig: GroupConfig;
    client: MangoClient;
    mangoAccount: MangoAccount;
    mangoGroup: MangoGroup;
    owner: Account;
    marketIndex: number

    constructor(url: string) {
        const config = new Config(configFile);
        this.groupConfig = config.getGroup(
            'mainnet',
            'mainnet.1',
        ) as GroupConfig;

        this.connection = new Connection(url);

    }

    async init(privateKey) {
        this.client = new MangoClient(this.connection, this.groupConfig.mangoProgramId);
        // load group & market
        const perpMarketConfig = getMarketByBaseSymbolAndKind(
            this.groupConfig,
            'SOL',
            'perp',
        );

        this.marketIndex = perpMarketConfig.marketIndex;
        this.mangoGroup = await this.client.getMangoGroup(this.groupConfig.publicKey);
        this.perpMarket = await this.mangoGroup.loadPerpMarket(
            this.connection,
            perpMarketConfig.marketIndex,
            perpMarketConfig.baseDecimals,
            perpMarketConfig.quoteDecimals,
        );
        this.owner = new Account(Uint8Array.from(privateKey));
        this.mangoAccount = (
            await this.client.getMangoAccountsForOwner(this.mangoGroup, this.owner.publicKey)
        )[0];
    }


    async getTopBid() {
        let bids = await this.perpMarket.loadBids(this.connection);
        return bids.getL2(1)[0][0]
    }

    async getTopAsk() {
        let asks = await this.perpMarket.loadAsks(this.connection);
        return asks.getL2(1)[0][0]
    }

    marketLong(usdAmount, topAsk, quantity) {
        const [nativePrice, nativeQuantity] = this.perpMarket.uiToNativePriceQuantity(
            topAsk,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.perpMarket.publicKey,
            this.perpMarket.bids,
            this.perpMarket.asks,
            this.perpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'buy', // or 'sell'
            'market',
        )
    }

    marketShort(usdAmount, topBid, quantity){
        const [nativePrice, nativeQuantity] = this.perpMarket.uiToNativePriceQuantity(
            topBid,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.perpMarket.publicKey,
            this.perpMarket.bids,
            this.perpMarket.asks,
            this.perpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'sell', // or 'sell'
            'market',
        )
    }
}

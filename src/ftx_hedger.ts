import MangoArbClient from "./mango";

import StatsD from 'hot-shots'
const dogstatsd = new StatsD();

let localOrders = []
const main = async () => {


    const mangoArbClient = new MangoArbClient('')
    await mangoArbClient.init(JSON.parse(''))

    const minChange = {
        'SOL': 5,
        'ETH': 0.3,
        'BTC': 0.02
    }

    const findPrice = (orderbook, size) => {
        let accSizes = 0
        for (const layer of orderbook) {
            accSizes += layer[1]
            if (accSizes >= (size / 3)) {
                return layer[0]
            }
        }
        return orderbook[0][0]
    }

    async function loop() {
        try {

            let mangoBalance = await mangoArbClient.getPositions()

            const markets = ['ETH', 'BTC', 'SOL']

            for (const market of markets) {
                const marketName = market + '/USD'

                const coins = (await mangoArbClient.ftx.getBalances())['result']
                const ftxCoinBalance = coins.filter(p => p['coin'] === market)[0]['total']


                const delta = mangoBalance[market] + ftxCoinBalance

                dogstatsd.gauge(`mmm.mango.coinBalance.${market}`, mangoBalance[market])
                dogstatsd.gauge(`mmm.ftx.coinBalance.${market}`, ftxCoinBalance)

                if (Math.abs(delta) > minChange[market]) {
                    const orderbook = (await mangoArbClient.ftx.getOrderbook({marketName: marketName}))['result']
                    const side = delta < 0 ? 'buy' : 'sell'
                    let price = delta < 0 ? findPrice(orderbook['bids'], delta) : findPrice(orderbook['asks'], delta)
                    let orders = (await mangoArbClient.ftx.getOpenOrders(marketName))['result']

                    if (orders.length > 1) {
                        await mangoArbClient.ftx.cancelAllOrders({market: marketName})
                        console.log(market, "canceled all orders")
                        orders = []
                    }
                    if (orders.length === 1 && orders[0]['price'] != price) {
                        if (orders[0]['side'] != side) {
                            await mangoArbClient.ftx.cancelOrder(orders[0]['id'].toString())
                            console.log(market,"Wrong side, canceled top order")
                        } else {
                            const newOrder = await mangoArbClient.ftx.modifyOrder({
                                orderId: orders[0]['id'].toString(),
                                price: price,
                                size: Math.abs(delta)
                            })
                            console.log(market, "updated", orders[0]['id'].toString(), newOrder['result']['id'], newOrder['result']['side'], newOrder['result']['size'], newOrder['result']['price'])
                        }
                    }
                    if (orders.length === 0) {
                        const currentTime = new Date().getTime() / 1000

                        localOrders = localOrders.filter(p => {
                            return p['market'] === marketName
                                && p['side'] === side
                                && p['epoch'] + 5 > currentTime
                        })

                        if (localOrders.length) {
                            console.log(market, "already have order in local")
                        } else {
                            const order = await mangoArbClient.ftx.placeOrder(
                                {
                                    market: marketName,
                                    side: side,
                                    price: price,
                                    size: Math.abs(delta),
                                    type: 'limit',
                                    postOnly: true
                                })
                            order['result']['epoch'] = currentTime
                            console.log(market, "placed", order['result']['id'], order['result']['side'], order['result']['size'], order['result']['price'])
                            localOrders.push(order['result'])
                        }
                    }
                }
            }
        } catch (e) {
            console.log(e)
        } finally {
            await new Promise(resolve => setTimeout(resolve, 1000));
            loop()
        }
    }

    setInterval(async function(){
        const mangoValue = await mangoArbClient.getAccountValue()
        const coins = (await mangoArbClient.ftx.getBalances())['result']
        const ftxValue = coins.map(item => item['usdValue']).reduce((prev, next) => prev + next);
        dogstatsd.gauge('mmm.mango.accountValue', mangoValue)
        dogstatsd.gauge('mmm.ftx.accountValue', ftxValue)
    }, 5000);

    await loop()
}

main()

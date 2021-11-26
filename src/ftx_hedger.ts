import MangoArbClient from "./mango";

let prevMangoBalance = 0
let prevFtxBalance = 0

let localOrders = []
const main = async () => {


    const mangoArbClient = new MangoArbClient('')
    await mangoArbClient.init(JSON.parse(''))
    const minChange = {
        'SOL': 0.5
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

            const coins = (await mangoArbClient.ftx.getBalances())['result']
            const ftxCoinBalance = coins.filter(p => p['coin'] === 'SOL')[0]['total']

            if (prevMangoBalance != mangoBalance || prevFtxBalance != ftxCoinBalance) {
                console.log(new Date().toLocaleString().replace(',', ''), mangoBalance, ftxCoinBalance)
                prevMangoBalance = mangoBalance
                prevFtxBalance = ftxCoinBalance
            }

            const delta = mangoBalance + ftxCoinBalance
            const marketName = 'SOL' + '/USD'

            if (Math.abs(delta) > minChange['SOL']) {
                const orderbook = (await mangoArbClient.ftx.getOrderbook({marketName: marketName}))['result']
                const side = delta < 0 ? 'buy' : 'sell'
                let price = delta < 0 ? findPrice(orderbook['bids'], delta) : findPrice(orderbook['asks'], delta)
                let orders = (await mangoArbClient.ftx.getOpenOrders(marketName))['result']

                if (orders.length > 1) {
                    await mangoArbClient.ftx.cancelAllOrders({market: marketName})
                    console.log("canceled all orders")
                    orders = []
                }
                if (orders.length === 1 && orders[0]['price'] != price) {
                    if (orders[0]['side'] != side) {
                        await mangoArbClient.ftx.cancelOrder(orders[0]['id'].toString())
                        console.log("Wrong side, canceled top order")
                    } else {
                        const newOrder = await mangoArbClient.ftx.modifyOrder({
                            orderId: orders[0]['id'].toString(),
                            price: price,
                            size: Math.abs(delta)
                        })
                        console.log("updated", orders[0]['id'].toString(), newOrder['result']['id'], newOrder['result']['side'], newOrder['result']['size'], newOrder['result']['price'])
                    }
                }
                if (orders.length === 0) {
                    const currentTime = new Date().getTime() / 1000
                    console.log("pre", localOrders)

                    localOrders = localOrders.filter(p => {
                        return p['market'] === marketName
                            && p['side'] === side
                            && p['epoch'] + 5 > currentTime
                    })

                    console.log("post", localOrders)

                    if (localOrders.length) {
                        console.log("already have order in local")
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
                        console.log("placed", order['result']['id'], order['result']['side'], order['result']['size'], order['result']['price'])
                        localOrders.push(order['result'])
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
            console.log(e)
        } finally {
            loop()
        }
    }

    await loop()
}

main()

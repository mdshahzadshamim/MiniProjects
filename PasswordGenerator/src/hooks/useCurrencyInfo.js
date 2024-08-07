import { useEffect, useState } from "react";

function useCurrencyInfo(currency) {
    const [data, setData] = useState({})
    let rates = 'rates'
    useEffect(() => {
        fetch(`https://api.currencybeacon.com/v1/latest?api_key=szjtPv18pR8K0BBMRgdxL6BS9m3WUskw&base=${currency}`)
        .then((res) => res.json())
        .then((res) => setData(res[rates]))
    }, [currency])
    console.log(data)
    return data
}

export default useCurrencyInfo

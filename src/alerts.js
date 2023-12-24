import { deleteAlert, getAlerts } from "./db.js";

const processAlert = (alert, price) => {
  if (
    (alert.target < price && "higher" === alert.alertOn) ||
    (alert.target > price && "lower" === alert.alertOn)
  ) {
    console.log(
      `Alert ${alert.id} sent. ${alert.pair} price went ${alert.alertOn} than ${alert.target} (${price})`
    );
    deleteAlert(alert.id);
  }
};

export const priceChangeHandler = async ({ price, pair }) => {
  const alerts = await getAlerts(pair);
  alerts.forEach((alert) => processAlert(alert, price));
};

import mongoose, { Document, Mongoose } from 'mongoose';

const AlertSchema = new mongoose.Schema<IAlert>({
  chatId: Number,
  target: Number,
  currency: {
    type: String,
    validate: {
      validator: v => v === 'usd' || v === 'eur',
      message: props => `${props.value} must be either 'usd' or 'eur'`,
    },
    default: 'usd'
  },
  alertOn: {
    type: String,
    validate: {
      validator: v => v === 'higher' || v === 'lower',
      message: props => `${props.value} must be either 'higher' or 'lower'`,
    },
    required: true
  }
});

const Alert = mongoose.model<IAlert>('Alert', AlertSchema);

let connection: Mongoose;

async function connect() {
  connection =
    connection ||
    (await mongoose.connect(process.env.MONGO_URL));
}

export type Currency = 'usd' | 'eur';

export type AlertOn = 'higher' | 'lower';

export interface IAlert extends Document {
  chatId: number;
  target: number;
  currency: Currency;
  alertOn: AlertOn;
}

export async function retrieve(): Promise<IAlert[]> {
  await connect();
  return Alert.find({});
}

export async function store(data: Pick<IAlert, 'currency' | 'chatId' | 'target' | 'alertOn'>): Promise<void> {
  await connect();
  const alert = new Alert();
  Object.assign(alert, data);
  await alert.save();
}

export async function remove(id: string): Promise<void> {
  await connect();
  await Alert.deleteOne({ _id: id });
}

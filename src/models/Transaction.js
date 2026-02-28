import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    stripeSessionId: { type: String, required: true, unique: true },
    amountPaid: { type: Number, required: true },
    currency: { type: String, required: true },
    fxRate: { type: Number, required: true },
    amountInEUR: { type: Number, required: true },
    packageType: { type: String, enum: ['boost', 'ppc'], required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    vatAmount: { type: Number, default: 0 },
    invoiceNumber: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);

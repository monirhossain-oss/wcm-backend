import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true, trim: true },
    image: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('Tag', tagSchema);

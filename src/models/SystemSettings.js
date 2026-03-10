import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  data: Object,
  lastUpdated: Date,
});

export const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

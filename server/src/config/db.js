import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';
 import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

export async function connectDb() {
  // strictQuery on: unknown filter keys are dropped rather than passed to MongoDB.
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  logger.info('MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

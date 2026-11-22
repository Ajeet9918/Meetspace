import mongoose from 'mongoose';

// Only the SHA-256 hash of the opaque refresh token is stored, so a database leak
// does not yield usable tokens.
const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true }, // one family per login session
  expiresAt: { type: Date, required: true },
  familyExpiresAt: { type: Date, required: true }, // absolute session cap
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// MongoDB removes expired documents automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RefreshToken', refreshTokenSchema);


import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema(
  {
    // 128-bit random id. Never sequential, never derived from anything guessable.
    roomId: { type: String, required: true, unique: true, match: /^[A-Za-z0-9_-]{22}$/ },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 100, default: '' },
    status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
    locked: { type: Boolean, default: false },
    maxParticipants: { type: Number, min: 2, max: 50, default: 50 },

    // Passcode is stored as an argon2id hash only.
    hasPasscode: { type: Boolean, default: false },
    passcodeHash: { type: String, select: false },
    passcodeFailures: { type: Number, default: 0, select: false },
    passcodeLockedUntil: { type: Date, default: null, select: false },

    // Invite links are not stored. They are HMAC(server key, roomId + inviteVersion).
    // Bumping inviteVersion invalidates every previously issued link.
    inviteVersion: { type: Number, default: 1 },
    inviteExpiresAt: { type: Date, default: null },

    // Removed users. Checked on every join and every socket connection.
    bannedDevices: { type: [String], default: [], select: false },
    bannedUsers: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },

    lastActivityAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null }, // set when the meeting ends; MongoDB's TTL monitor deletes the document
  },
  { timestamps: true }
);

meetingSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
meetingSchema.index({ status: 1, lastActivityAt: 1 });

export default mongoose.model('Meeting', meetingSchema);

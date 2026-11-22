import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false so the hash is never loaded or serialized unless explicitly requested.
    passwordHash: { type: String, required: true, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this._id.toString(), displayName: this.displayName, email: this.email };
};

export default mongoose.model('User', userSchema);

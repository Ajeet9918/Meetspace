import { z } from 'zod';

const clean = (v) => !/[\u0000-\u001F\u007F<>]/.test(v);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(50, 'Name must be 50 characters or fewer')
  .refine(clean, 'Name contains invalid characters');

export const titleSchema = z.string().trim().max(100, 'Title must be 100 characters or fewer').refine(clean, 'Title contains invalid characters');
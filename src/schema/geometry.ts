import { z } from 'zod'

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export type Vec3 = z.infer<typeof vec3Schema>


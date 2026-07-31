import { z } from 'zod'
import { assetSchema, type Asset } from './assets'
import { projectAudioSchema } from './audio'
import { bookSchema } from './book'

export const bookProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  book: bookSchema,
  assets: z.array(assetSchema),
  audio: projectAudioSchema.optional(),
  updatedAt: z.string(),
})

export type BookProjectFile = z.infer<typeof bookProjectSchema>

export interface BookProject extends Omit<BookProjectFile, 'assets'> {
  assets: Asset[]
}

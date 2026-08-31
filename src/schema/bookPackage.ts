import { z } from 'zod'
import { assetSchema, type Asset } from './assets'
import { projectAudioSchema } from './audio'
import { authoringGuideSchema, DEFAULT_AUTHORING_GUIDE, migrateAuthoringGuide } from './authoringGuide'
import { bookSchema } from './book'

export const bookProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  authoringGuide: z.preprocess(migrateAuthoringGuide, authoringGuideSchema).default(() => structuredClone(DEFAULT_AUTHORING_GUIDE)),
  book: bookSchema,
  assets: z.array(assetSchema),
  audio: projectAudioSchema.optional(),
  updatedAt: z.string(),
})

export type BookProjectFile = z.infer<typeof bookProjectSchema>

export interface BookProject extends Omit<BookProjectFile, 'assets'> {
  assets: Asset[]
}

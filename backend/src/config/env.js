import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

function getRequiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const MONGODB_URI = getRequiredEnv('MONGODB_URI')
export const JWT_SECRET = getRequiredEnv('JWT_SECRET')
if (Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
  throw new Error('JWT_SECRET must be at least 32 bytes long')
}

export const JWT_EXPIRES_IN_SECONDS = Number(
  process.env.JWT_EXPIRES_IN_SECONDS ?? 86400
)
export const IMAGEKIT_PRIVATE_KEY = getRequiredEnv('IMAGEKIT_PRIVATE_KEY')
export const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY || ''
export const IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT || ''
const frontendOrigin = process.env.FRONTEND_ORIGIN
export const FRONTEND_ORIGIN = frontendOrigin
  ? new URL(frontendOrigin).origin
  : ''
export const PORT = Number(process.env.PORT || 3000)

if (
  !Number.isInteger(JWT_EXPIRES_IN_SECONDS) ||
  JWT_EXPIRES_IN_SECONDS < 60 ||
  JWT_EXPIRES_IN_SECONDS > 2592000
) {
  throw new Error('JWT_EXPIRES_IN_SECONDS must be an integer between 60 and 2592000')
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

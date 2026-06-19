import qs from 'node:querystring'
import { SearchQueries } from '../../types'
import type { FastifyReply, FastifyRequest } from 'fastify'

export const home = async (
  request: FastifyRequest<{ Querystring: SearchQueries }>,
  reply: FastifyReply
) => {
  const { q } = request.query

  if (typeof q !== 'undefined' && q.trim() !== '') {
    const baseurl = `${request.protocol}://${request.hostname}`
    return reply.redirect(`${baseurl}/search/?${qs.stringify(request.query)}`, 301)
  }

  return reply.redirect('https://github.com/sooluh/kodepos')
}

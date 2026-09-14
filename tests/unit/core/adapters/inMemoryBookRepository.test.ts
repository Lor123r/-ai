import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { describeBookRepositoryContract } from '../contracts/bookRepositoryContract'

describeBookRepositoryContract('InMemoryBookRepository', () => new InMemoryBookRepository())

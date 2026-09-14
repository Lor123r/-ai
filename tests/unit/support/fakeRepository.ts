import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook, type Book } from '@core/domain/book'

export const TEST_BOOK_ADDED_AT = 1_700_000_000_000

/**
 * 造一个已经有一本书的书库。
 * InMemoryBookRepository 的 saveLocator 要求书先存在，
 * 所以进度相关的测试都得先把书放进去。
 */
export async function seedRepository(overrides: Partial<Book> = {}): Promise<{
  repository: InMemoryBookRepository
  book: Book
}> {
  const book: Book = {
    ...createBook(
      {
        id: 'book-1',
        title: '三体',
        author: '刘慈欣',
        format: 'epub',
        filePath: 'C:/library/book-1.epub',
        fileSize: 2048
      },
      TEST_BOOK_ADDED_AT
    ),
    ...overrides
  }

  const repository = new InMemoryBookRepository()
  await repository.save(book)
  return { repository, book }
}

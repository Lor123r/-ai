import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'

export default function App(): React.JSX.Element {
  return (
    <BookRepositoryProvider>
      <Bookshelf />
    </BookRepositoryProvider>
  )
}

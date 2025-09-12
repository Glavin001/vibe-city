export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <h2 className="text-4xl font-bold text-white mb-4">Not Found</h2>
        <p className="text-gray-300 mb-8">Could not find requested resource</p>
        <a
          href="/"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Return Home
        </a>
      </div>
    </div>
  )
}

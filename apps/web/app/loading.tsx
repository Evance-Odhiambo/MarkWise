export default function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full border-4 border-gray-200 border-t-indigo-600 animate-spin" />
        <p className="text-gray-500 text-sm font-medium">Loading...</p>
      </div>
    </main>
  );
}

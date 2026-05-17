export default function RouteCard({ route, selected, onClick, live }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
        selected
          ? "bg-orange-500 border-orange-400 text-white"
          : "bg-gray-800 border-gray-700 text-gray-200 hover:border-orange-500"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">{route.name}</p>
          <p className={`text-xs mt-0.5 ${selected ? "text-orange-100" : "text-gray-400"}`}>
            {route.label}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            live
              ? "bg-green-500 text-white"
              : selected
              ? "bg-orange-600 text-orange-100"
              : "bg-gray-700 text-gray-400"
          }`}
        >
          {live ? "● Live" : "Offline"}
        </span>
      </div>
      {route.description && (
        <p className={`text-xs mt-1.5 ${selected ? "text-orange-100" : "text-gray-500"}`}>
          {route.description}
        </p>
      )}
    </button>
  );
}

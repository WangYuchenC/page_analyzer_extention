import { Network } from "lucide-react";
import type { NetworkRequest, NetworkResponse } from "~types";

interface NetworkTabProps {
  requests: NetworkRequest[];
  responses: NetworkResponse[];
}

export default function NetworkTab({ requests, responses }: NetworkTabProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 space-y-2">
        {requests.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm">
            <Network className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            暂无网络请求
          </div>
        ) : (
          requests.map((req) => {
            const response = responses.find((r) => r.requestId === req.requestId);
            return (
              <div key={req.requestId} className="bg-white border border-gray-200 rounded p-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-1.5 py-0.5 rounded font-medium ${
                      req.method === "GET"
                        ? "bg-green-100 text-green-700"
                        : req.method === "POST"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {req.method}
                  </span>
                  <span className="text-gray-600 truncate flex-1">{req.url}</span>
                </div>
                {response && (
                  <div className="flex items-center gap-2 text-gray-500">
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        response.status < 300
                          ? "bg-green-50 text-green-600"
                          : response.status < 400
                            ? "bg-yellow-50 text-yellow-600"
                            : "bg-red-50 text-red-600"
                      }`}
                    >
                      {response.status}
                    </span>
                    {response.body && (
                      <span className="text-gray-400">{response.body.length} bytes</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

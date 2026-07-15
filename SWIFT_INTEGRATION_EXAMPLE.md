# Exemplo de integração Swift

O aplicativo já pode ter um serviço semelhante. Este exemplo mostra o formato esperado pelo backend.

```swift
import Foundation

struct AIChatMessage: Codable {
    let role: String
    let content: String
}

struct AIChatRequest: Codable {
    let messages: [AIChatMessage]
    let teacherMode: Bool
    let userName: String?
    let memory: [String: String]?
}

struct AIChatResponse: Codable {
    let reply: String
    let blocked: Bool?
}

enum AIChatError: LocalizedError {
    case invalidURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Endereço do servidor inválido."
        case .invalidResponse:
            return "Resposta inválida do servidor."
        case .server(let message):
            return message
        }
    }
}

actor AIChatClient {
    private let endpoint: URL
    private let session: URLSession

    init(endpointString: String, session: URLSession = .shared) throws {
        guard let endpoint = URL(string: endpointString) else {
            throw AIChatError.invalidURL
        }

        self.endpoint = endpoint
        self.session = session
    }

    func send(
        messages: [AIChatMessage],
        teacherMode: Bool,
        userName: String?
    ) async throws -> String {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 35
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Use um identificador anônimo persistente, não um dado sensível.
        request.setValue(
            UIDevice.current.identifierForVendor?.uuidString,
            forHTTPHeaderField: "X-Client-ID"
        )

        request.httpBody = try JSONEncoder().encode(
            AIChatRequest(
                messages: Array(messages.suffix(30)),
                teacherMode: teacherMode,
                userName: userName,
                memory: nil
            )
        )

        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw AIChatError.invalidResponse
        }

        if !(200...299).contains(http.statusCode) {
            let object = try? JSONSerialization.jsonObject(with: data)
            let dictionary = object as? [String: Any]
            let error = dictionary?["error"] as? String
            throw AIChatError.server(error ?? "Falha no servidor.")
        }

        return try JSONDecoder().decode(AIChatResponse.self, from: data).reply
    }
}
```

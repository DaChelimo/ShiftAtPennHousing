import SwiftUI
import Shared

struct ContentView: View {
    // Calls into the shared Kotlin module — the same logic that backs the
    // Android app. To wire the shared MainViewModel into SwiftUI, expose its
    // StateFlow via SKIE and observe it here (see iosApp/README.md).
    let greeting = Greeting().greet()

    var body: some View {
        VStack {
            Text(greeting)
                .font(.title2)
                .multilineTextAlignment(.center)
                .padding()
        }
    }
}

#Preview {
    ContentView()
}

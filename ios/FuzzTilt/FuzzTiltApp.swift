import SwiftUI
import UIKit

@main
struct FuzzTiltApp: App {
    var body: some Scene {
        WindowGroup {
            TiltControllerView()
        }
    }
}

private struct TiltControllerView: View {
    @StateObject private var session = TiltSession()
    @Environment(\.scenePhase) private var scenePhase
    @State private var host = ""
    @FocusState private var editingHost: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Mac Wi-Fi IP address", text: $host)
                        .keyboardType(.numbersAndPunctuation)
                        .submitLabel(.done)
                        .onSubmit { editingHost = false }
                        .autocorrectionDisabled()
                        .focused($editingHost)
                        .disabled(session.isRunning)
                } header: {
                    Text("Fuzz on your Mac")
                } footer: {
                    Text("Enter the Mac’s IPv4 address shown in Fuzz’s Head tilt panel. Keep both devices on the same Wi-Fi.")
                }

                Section {
                    Text(session.status)
                    if let degrees = session.rollDegrees {
                        LabeledContent("Headphone roll") {
                            Text("\(degrees, specifier: "%.0f")°")
                                .monospacedDigit()
                        }
                    }
                    Button(session.isRunning ? "Stop sending" : "Start sending") {
                        editingHost = false
                        if session.isRunning {
                            session.stop()
                        } else {
                            session.start(host: host.trimmingCharacters(in: .whitespacesAndNewlines))
                        }
                    }
                    .disabled(!session.isRunning && host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: {
                    Text("AirPods")
                } footer: {
                    Text("Wear your AirPods and hold your usual playing posture until Fuzz shows Tracking. Then tilt toward either shoulder.")
                }
            }
            .navigationTitle("Fuzz Head Tilt")
        }
        .onChange(of: session.isRunning) { running in
            UIApplication.shared.isIdleTimerDisabled = running
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background && session.isRunning {
                session.stop()
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }
}

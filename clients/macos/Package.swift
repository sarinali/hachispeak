// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "out-loud-bar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "OutLoudBar",
            path: "Sources/OutLoudBar"
        ),
    ]
)

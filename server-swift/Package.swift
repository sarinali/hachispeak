// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "out-loud-server",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/soniqo/speech-swift", exact: "0.0.20"),
        .package(url: "https://github.com/hummingbird-project/hummingbird", from: "2.5.0"),
        .package(url: "https://github.com/gaelic-ghost/TextForSpeech.git", from: "0.23.0"),
    ],
    targets: [
        .executableTarget(
            name: "OutLoudServer",
            dependencies: [
                .product(name: "KokoroTTS", package: "speech-swift"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "TextForSpeech", package: "TextForSpeech"),
            ]
        ),
        .testTarget(
            name: "NormalizationTests",
            dependencies: [
                .product(name: "TextForSpeech", package: "TextForSpeech"),
            ]
        ),
    ]
)

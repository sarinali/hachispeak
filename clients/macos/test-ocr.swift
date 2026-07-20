#!/usr/bin/env swift
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    print("Usage: swift test-ocr.swift <image-path>")
    exit(1)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { print("Failed to load image: \(path)"); exit(1) }

let start = Date()
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
try? VNImageRequestHandler(cgImage: cgImage).perform([req])
let elapsed = Date().timeIntervalSince(start)

let lines = (req.results as? [VNRecognizedTextObservation])?
    .compactMap { $0.topCandidates(1).first?.string } ?? []

print(String(format: "--- %.2fs ---", elapsed))
lines.forEach { print($0) }
if lines.isEmpty { print("(no text recognized)") }

// Models.swift
// AlphaDesk
//
// Domain models for the AlphaDesk trading platform.
// All types are Codable and use snake_case JSON keys via
// JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase.

import Foundation

// MARK: - Auth

struct TokenResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    let expiresIn: Int
}

// MARK: - Portfolio

struct PortfolioSummary: Codable, Sendable, Identifiable {
    var id: String { "portfolio" }

    let equity: Double
    let cash: Double
    let buyingPower: Double
    let totalMarketValue: Double
    let unrealizedPnl: Double
    let unrealizedPnlPct: Double
    let realizedPnlToday: Double
    let positionsCount: Int
    let lastUpdated: Date
}

// MARK: - Positions

struct Position: Codable, Sendable, Identifiable {
    var id: String { symbol }

    let symbol: String
    let quantity: Double
    let side: String
    let avgCost: Double
    let currentPrice: Double
    let marketValue: Double
    let unrealizedPnl: Double
    let unrealizedPnlPct: Double
    let assetClass: String?
}

// MARK: - Market Data

struct Quote: Codable, Sendable, Identifiable {
    var id: String { symbol }

    let symbol: String
    let bid: Double
    let ask: Double
    let last: Double
    let volume: Int
    let timestamp: Date?
    let change: Double?
    let changePct: Double?
    let high: Double?
    let low: Double?
    let open: Double?
    let close: Double?
}

struct OHLCVBar: Codable, Sendable, Identifiable {
    var id: Date { timestamp }

    let timestamp: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Int
    let vwap: Double?
}

// MARK: - Strategies

enum StrategyStatus: String, Codable, Sendable {
    case active
    case paused
    case backtest
}

struct Strategy: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let status: StrategyStatus
    let investedAmount: Double
    let totalReturnPct: Double
    let sharpeRatio: Double
    let winRate: Double
    let activePositionsCount: Int
}

struct EquityCurvePoint: Codable, Sendable {
    let date: String?
    let value: Double?
    let index: Int?
    let cumulativePnl: Double?
}

struct StrategyPerformance: Codable, Sendable, Identifiable {
    var id: String { name }

    let name: String
    let description: String
    let status: StrategyStatus
    let investedAmount: Double
    let currentValue: Double
    let totalReturnPct: Double
    let annualizedReturnPct: Double?
    let returnDollars: Double?
    let sharpeRatio: Double?
    let maxDrawdown: Double?
    let winRate: Double
    let activePositionsCount: Int
    let equityCurve: [EquityCurvePoint]
    let lastTradeDate: String?
}

// MARK: - Market Overview

struct MarketIndex: Codable, Sendable, Identifiable {
    var id: String { symbol }

    let symbol: String
    let name: String
    let price: Double
    let change: Double
    let changePct: Double
    let prevClose: Double?
}

struct IndicesResponse: Codable, Sendable {
    let indices: [MarketIndex]
    let asOf: Date?
}

// MARK: - News

struct NewsArticle: Codable, Sendable, Identifiable {
    var id: String { url + title }

    let title: String
    let description: String?
    let url: String
    let source: String?
    let publishedAt: String
    let imageUrl: String?
    let sentiment: String?
    let symbols: [String]?
}

struct NewsResponse: Codable, Sendable {
    let articles: [NewsArticle]
    let query: String?
    let count: Int?
}

// MARK: - Pipeline

struct PipelineStatus: Codable, Sendable {
    let running: Bool
    let lastRun: String?
    let lastResult: String?
}

struct PipelinePosition: Codable, Sendable, Identifiable {
    var id: String { symbol + (strategy ?? "") }

    let symbol: String
    let shares: Double?
    let entryPrice: Double?
    let currentPrice: Double?
    let pnl: Double?
    let pnlPct: Double?
    let strategy: String?
    let entryTime: String?
    let stopLoss: Double?
    let targetPrice: Double?
    let status: String?
}

struct PipelinePerformance: Codable, Sendable {
    let totalTrades: Int?
    let openTrades: Int?
    let closedTrades: Int?
    let totalPnl: Double?
    let winRate: Double?
    let avgWin: Double?
    let avgLoss: Double?
}

struct PipelinePositionsResponse: Codable, Sendable {
    let openPositions: [PipelinePosition]
    let performance: PipelinePerformance?
}

// MARK: - WebSocket Messages

enum WSIncomingMessage: Sendable {
    case authenticated
    case subscribed(channel: String)
    case unsubscribed(channel: String)
    case pong
    case channelData(channel: String, data: [String: Any])
    case error(String)
    case unknown([String: Any])
}

struct WSOutgoingMessage: Encodable, Sendable {
    let action: String
    let token: String?
    let channel: String?

    init(action: String, token: String? = nil, channel: String? = nil) {
        self.action = action
        self.token = token
        self.channel = channel
    }

    static func auth(token: String) -> WSOutgoingMessage {
        WSOutgoingMessage(action: "auth", token: token)
    }

    static func subscribe(channel: String) -> WSOutgoingMessage {
        WSOutgoingMessage(action: "subscribe", channel: channel)
    }

    static func unsubscribe(channel: String) -> WSOutgoingMessage {
        WSOutgoingMessage(action: "unsubscribe", channel: channel)
    }

    static var ping: WSOutgoingMessage {
        WSOutgoingMessage(action: "ping")
    }
}

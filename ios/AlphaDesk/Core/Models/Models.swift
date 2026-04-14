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
    let sparkline: [Double]?
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

struct PipelinePositionsResponse: Sendable {
    let positions: [PipelinePosition]
    let performance: PipelinePerformance?
}

extension PipelinePositionsResponse: Decodable {
    enum CodingKeys: String, CodingKey {
        case positions, openPositions, performance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        performance = try container.decodeIfPresent(PipelinePerformance.self, forKey: .performance)
        if let p = try? container.decode([PipelinePosition].self, forKey: .positions) {
            positions = p
        } else {
            positions = (try? container.decode([PipelinePosition].self, forKey: .openPositions)) ?? []
        }
    }
}

// MARK: - WebSocket Messages

enum WSIncomingMessage: @unchecked Sendable {
    case authenticated
    case subscribed(channel: String)
    case unsubscribed(channel: String)
    case pong
    case channelData(channel: String, data: [String: Any])
    case error(String)
    case unknown([String: Any])
}

// MARK: - Regime

struct RegimeData: Codable, Sendable {
    let regime: String
    let confidence: Double?
    let description: String?
    let updatedAt: String?
}

// MARK: - Search

struct SymbolSearchResult: Codable, Sendable, Identifiable {
    var id: String { symbol }
    let symbol: String
    let name: String?
    let type: String?
}

// MARK: - Order

struct OrderRequest: Codable, Sendable {
    let symbol: String
    let qty: Int
    let side: String
    let type: String
    let limitPrice: Double?
    let stopPrice: Double?
    let timeInForce: String
}

struct OrderResponse: Codable, Sendable {
    let id: String?
    let clientOrderId: String?
    let status: String?
    let symbol: String?
    let qty: String?
    let side: String?
    let type: String?
    let filledQty: String?
    let filledAvgPrice: String?
}

// MARK: - AI Chat

struct ChatRequest: Codable, Sendable {
    let message: String
    let context: ChatContext?
}

struct ChatContext: Codable, Sendable {
    let symbol: String?
    let portfolioValue: Double?
}

struct ChatResponse: Codable, Sendable {
    let message: String
    let actionsTaken: [String]?
    let suggestions: [String]?
    let conversationId: String?
    let timestamp: String?
}

// MARK: - Order (for order history)

struct Order: Codable, Sendable, Identifiable {
    /// Stable fallback ID when the server does not return an order ID.
    private var _fallbackId: String?
    var id: String {
        if let orderId { return orderId }
        if let fallback = _fallbackId { return fallback }
        // Will be set during decoding via CodingKeys
        return clientOrderId ?? symbol + side + (createdAt ?? "")
    }

    let orderId: String?
    let clientOrderId: String?
    let symbol: String
    let qty: String?
    let side: String
    let type: String?
    let status: String?
    let filledQty: String?
    let filledAvgPrice: String?
    let limitPrice: String?
    let stopPrice: String?
    let createdAt: String?
    let updatedAt: String?
    let submittedAt: String?
    let filledAt: String?
}

// MARK: - Portfolio Performance (detailed)

struct PortfolioPerformanceDetail: Codable, Sendable {
    let totalReturn: Double?
    let totalReturnPct: Double?
    let sharpeRatio: Double?
    let maxDrawdown: Double?
    let maxDrawdownPct: Double?
    let equityCurve: [EquityCurvePoint]?
    let annualizedReturn: Double?
    let volatility: Double?
    let winRate: Double?
    let calmarRatio: Double?
}

// MARK: - Monthly Returns

struct MonthlyReturn: Codable, Sendable, Identifiable {
    var id: String { "\(year)-\(month)" }

    let year: Int
    let month: Int
    let returnPct: Double
}

struct PortfolioCalendarResponse: Codable, Sendable {
    let monthlyReturns: [MonthlyReturn]?
    let dailyReturns: [DailyReturn]?
}

struct DailyReturn: Codable, Sendable, Identifiable {
    var id: String { date }

    let date: String
    let returnPct: Double
    let pnl: Double?
}

// MARK: - Strategy Positions

struct StrategyPosition: Codable, Sendable, Identifiable {
    var id: String { symbol + (strategy ?? "") }
    let symbol: String
    let shares: Double?
    let quantity: Double?
    let entryPrice: Double?
    let currentPrice: Double?
    let pnl: Double?
    let pnlPct: Double?
    let strategy: String?
    let side: String?
    let entryDate: String?
}

// MARK: - Pipeline Run

struct PipelineRunRequest: Codable, Sendable {
    let force: Bool
}

struct PipelineRunResponse: Codable, Sendable {
    let status: String?
    let message: String?
    let runId: String?
}

struct PipelineHistoryEntry: Codable, Sendable, Identifiable {
    var id: String { (startedAt ?? "") + (status ?? "") }
    let startedAt: String?
    let completedAt: String?
    let status: String?
    let strategiesRun: Int?
    let symbolsScreened: Int?
    let symbolsAnalyzed: Int?
    let ordersPlaced: Int?
    let ordersClosed: Int?
    let errors: Int?
    let duration: Double?
    let result: String?
}

// MARK: - Performance Data (for equity curve)

struct PerformanceData: Codable, Sendable {
    let equityCurve: [EquityCurvePoint]?
    let dates: [String]?
    let values: [Double]?
    let totalReturn: Double?
    let period: String?
}

// MARK: - Price Alerts

struct PriceAlert: Codable, Sendable, Identifiable {
    let id: String
    let symbol: String
    let condition: String // "above" or "below"
    let price: Double
    let createdAt: String
    let triggered: Bool
    let triggeredAt: String?
}

// MARK: - WebSocket Messages

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

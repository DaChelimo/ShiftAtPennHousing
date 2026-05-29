package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.Greeting
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MainUiState(
    val greeting: String = "",
)

/**
 * Shared ViewModel — a single source of truth consumed by BOTH the Android
 * (Jetpack Compose) and iOS (SwiftUI, via SKIE) UIs. This is the Fruitties
 * "shared logic + native UI" pattern: state and behavior live here once.
 */
class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(MainUiState(greeting = Greeting().greet()))
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()
}

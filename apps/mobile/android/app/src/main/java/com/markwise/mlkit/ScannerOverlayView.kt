package com.markwise.mlkit

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

class ScannerOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val backgroundPaint: Paint = Paint().apply {
        isAntiAlias = true
        color = Color.parseColor("#99000000")
        style = Paint.Style.FILL
    }

    private val cornerPaint: Paint = Paint().apply {
        color = Color.parseColor("#4CAF50") // Green color for corners
        style = Paint.Style.STROKE
        strokeWidth = 12f
        strokeCap = Paint.Cap.ROUND
    }

    private val boxRect: RectF = RectF()
    private val path = Path()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        // Define the clear scanning area
        val boxWidth = width * 0.75f
        val boxHeight = boxWidth * 0.75f
        val left = (width - boxWidth) / 2
        val top = (height - boxHeight) / 2
        boxRect.set(left, top, left + boxWidth, top + boxHeight)

        // Draw dark mask around clear scanning area using even-odd fill (device-safe)
        path.reset()
        path.fillType = Path.FillType.EVEN_ODD
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        path.addRoundRect(boxRect, 16f, 16f, Path.Direction.CCW)
        canvas.drawPath(path, backgroundPaint)

        // Draw the corner guides
        val cornerLength = boxWidth * 0.1f
        val cornerRadius = 8f
        path.reset()

        // Top-left corner
        path.moveTo(boxRect.left, boxRect.top + cornerLength)
        path.lineTo(boxRect.left, boxRect.top + cornerRadius)
        path.quadTo(boxRect.left, boxRect.top, boxRect.left + cornerRadius, boxRect.top)
        path.lineTo(boxRect.left + cornerLength, boxRect.top)

        // Top-right corner
        path.moveTo(boxRect.right - cornerLength, boxRect.top)
        path.lineTo(boxRect.right - cornerRadius, boxRect.top)
        path.quadTo(boxRect.right, boxRect.top, boxRect.right, boxRect.top + cornerRadius)
        path.lineTo(boxRect.right, boxRect.top + cornerLength)

        // Bottom-right corner
        path.moveTo(boxRect.right, boxRect.bottom - cornerLength)
        path.lineTo(boxRect.right, boxRect.bottom - cornerRadius)
        path.quadTo(boxRect.right, boxRect.bottom, boxRect.right - cornerRadius, boxRect.bottom)
        path.lineTo(boxRect.right - cornerLength, boxRect.bottom)

        // Bottom-left corner
        path.moveTo(boxRect.left + cornerLength, boxRect.bottom)
        path.lineTo(boxRect.left + cornerRadius, boxRect.bottom)
        path.quadTo(boxRect.left, boxRect.bottom, boxRect.left, boxRect.bottom - cornerRadius)
        path.lineTo(boxRect.left, boxRect.bottom - cornerLength)

        canvas.drawPath(path, cornerPaint)
    }
}

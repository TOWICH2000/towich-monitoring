require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Check Google Sheet for errors
app.get("/api/sheets/check", async (req, res) => {
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: process.env.SHEET_NAME,
    });

    const rows = response.data.values;
    const errors = [];
    const errorKeywords = process.env.ERROR_KEYWORDS.split(",");

    if (rows && rows.length) {
      const header = rows[0];
      const errorColIndex = header.indexOf(process.env.ERROR_COLUMN_NAME);

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const explanations = [];

        // Check error column
        if (errorColIndex !== -1 && row[errorColIndex]) {
          const status = row[errorColIndex].toLowerCase();
          if (errorKeywords.some((k) => status.includes(k))) {
            explanations.push("Статус содержит слово об ошибке");
          }
        }

        // Check required fields
        const requiredFields = [
          "ФИО сотрудника",
          "Должность",
          "Отдел",
          "Оклад ($)",
          "Премия ($)",
          "Итого ($)",
          "Дата отчета",
        ];
        requiredFields.forEach((field) => {
          const colIndex = header.indexOf(field);
          if (
            colIndex !== -1 &&
            (!row[colIndex] || row[colIndex].trim() === "")
          ) {
            explanations.push(`Поле '${field}' пустое`);
          }
        });

        // Check numeric fields
        const numericFields = {
          "Оклад ($)": 200,
          "Премия ($)": 20,
          "Итого ($)": 250,
        };

        Object.entries(numericFields).forEach(([field, limit]) => {
          const colIndex = header.indexOf(field);
          if (colIndex !== -1 && row[colIndex]) {
            const value = parseFloat(row[colIndex]);
            if (isNaN(value)) {
              explanations.push(`${field} указано некорректно (не число)`);
            } else if (value <= limit) {
              explanations.push(
                `💸 Ошибка в ${field}: ${value}\n🧠 Причина: ${field} слишком мал или равен (${value} ≤ ${limit})`
              );
            }
          }
        });

        // Check date format
        const dateColIndex = header.indexOf("Дата отчета");
        if (dateColIndex !== -1 && row[dateColIndex]) {
          const dateStr = row[dateColIndex];
          if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
            explanations.push(
              `📅 Ошибка в дате: ${dateStr}\n🧠 Причина: Неверный формат (дд.мм.гггг)`
            );
          } else {
            const [day, month, year] = dateStr.split(".").map(Number);
            if (
              !(
                1 <= day &&
                day <= 31 &&
                1 <= month &&
                month <= 12 &&
                year >= 2025
              )
            ) {
              explanations.push(
                `📅 Ошибка в дате: ${dateStr}\n🧠 Причина: Неверная дата (день/месяц/год вне допустимого диапазона)`
              );
            }
          }
        }

        if (explanations.length > 0) {
          const rowData = {
            row: i + 1,
            details: explanations,
            values: {
              "№": row[header.indexOf("№")] || "?",
              "ФИО сотрудника": row[header.indexOf("ФИО сотрудника")] || "?",
              Должность: row[header.indexOf("Должность")] || "?",
              Отдел: row[header.indexOf("Отдел")] || "?",
            },
          };
          errors.push(rowData);
        }
      }
    }

    res.json({ errors });
  } catch (error) {
    console.error("Error checking sheet:", error);
    res.status(500).json({ error: error.message });
  }
});

// Send Telegram message
app.post("/api/telegram/send", async (req, res) => {
  try {
    const { message } = req.body;
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
      }
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Telegram send error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Send Email
app.post("/api/email/send", async (req, res) => {
  try {
    const { subject = "Уведомление", message } = req.body;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: subject,
      text: message,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

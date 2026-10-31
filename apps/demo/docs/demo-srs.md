# ShopEasy Demo – Software Requirements Specification

This document describes the ShopEasy demo store. It is used to demonstrate QA Pilot.

## 1 Login

The system shall allow registered users to log in with email and password. The account must be locked after 3 consecutive failed login attempts. A locked account is unlocked by an administrator.

## 2 Registration

- Email is a mandatory field and must be a valid email format.
- Password must be 8 to 16 characters long.
- Password must contain at least one digit.
- An error message is shown next to each invalid field.

## 3 Checkout

Card number must be 16 digits. Orders above Rs. 5000 receive a 10% discount. Payments are processed through the payment gateway API. The checkout page should load fast.

## 4 Out of scope

Social login is out of scope for this release.

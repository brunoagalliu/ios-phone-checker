import './globals.css';

export const metadata = {
  title: 'Phone Number Validator',
  description: 'Validate US phone numbers and check iOS/iMessage support',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head />
      <body>
        {children}
      </body>
    </html>
  );
}
import os
import sys
from openai import OpenAI

# Initialize the client (automatically inherits your saved OPENAI_API_KEY secret)
try:
    client = OpenAI()
except Exception as e:
    print(f"❌ Initialization Error: {e}")
    sys.exit(1)


def run_live_test():
    print("🛰️  Pinging OpenAI live chat completions endpoint...")
    try:
        # Requesting a fast, lightweight model to test access
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": "Respond with the word 'SUCCESS' if you receive this script's request.",
                }
            ],
            max_tokens=10,
        )

        # Read and print the live string output
        result = response.choices[0].message.content.strip()
        print(f"\n🎉 Live Connection Verified!")
        print(f"🤖 OpenAI Response: {result}\n")
        print(
            "💡 Summary: Your key balance is healthy, valid, and successfully authenticated."
        )

    except Exception as e:
        print("\n❌ Live API Test Failed!")
        print(f"Error Details: {e}")
        print("\n💡 Troubleshooting Tips:")
        print(
            " - Verify you have funds loaded on your OpenAI Developer Platform billing account."
        )
        print(" - Check that your key hasn't been restricted, revoked, or expired.")


if __name__ == "__main__":
    run_live_test()

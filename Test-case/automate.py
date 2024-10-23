import os
import time
import zipfile
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.common.exceptions import (
    WebDriverException,
    NoSuchElementException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Function to package the extension directory into a .xpi file
def package_extension(extension_dir, output_path):
    """
    Packages the extension directory into a .xpi file.

    :param extension_dir: Path to the extension directory containing manifest.json
    :param output_path: Path where the .xpi file will be saved
    """
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as xpi:
        for root, dirs, files in os.walk(extension_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # Compute the relative path to maintain directory structure
                relative_path = os.path.relpath(file_path, extension_dir)
                xpi.write(file_path, relative_path)
    print(f"Extension packaged as .xpi at: {output_path}")

# Function to read links from a text file
def read_links(file_path):
    with open(file_path, 'r') as file:
        return [line.strip() for line in file if line.strip()]

# Function to ensure URLs are properly formatted
def format_link(link):
    if not link.startswith(('http://', 'https://')):
        return 'http://' + link
    return link

# Function to log the state of the visited URL to a file
def log_url_state(log_file_path, link, status, error_message=None, final_state=None):
    with open(log_file_path, 'a') as log_file:
        log_file.write(f"URL: {link}\n")
        if status == "success":
            log_file.write(f"Visited successfully. Final state: {final_state}\n")
        elif status == "failed_to_load":
            log_file.write(f"Failed to load after timeout. Final state: {final_state}\n")
        elif status == "error":
            log_file.write(f"Error: {error_message}. Final state: {final_state}\n")
        log_file.write("\n")

# Function to log browser console output to a separate file
def log_console_output(console_log_file_path, link, console_logs):
    with open(console_log_file_path, 'a') as log_file:
        log_file.write(f"URL: {link}\n")
        if console_logs:
            log_file.write("Browser Console Logs:\n")
            for entry in console_logs:
                log_file.write(f"{entry['level']}: {entry['message']}\n")
        else:
            log_file.write("No console logs found.\n")
        log_file.write("\n")

# Function to set extension settings via injected JavaScript
def set_extension_settings(driver, mode, threshold):
    """
    Sends a message to the extension's background script to set mode and threshold.
    """
    try:
        # Execute JavaScript to send a message to the extension
        script = f"""
        browser.runtime.sendMessage({{
            setMode: '{mode}',
            setEntropyThreshold: {threshold}
        }}).then(response => {{
            console.log('Extension settings updated:', response.status);
        }}).catch(error => {{
            console.error('Error updating extension settings:', error);
        }});
        """
        driver.execute_script(script)
        print(f"Sent settings to extension: mode={mode}, threshold={threshold}")
        
        # Optionally, wait for confirmation (if the extension sends a response)
        time.sleep(2)  # Adjust sleep time as needed
        
    except Exception as e:
        print(f"Error sending settings to extension: {e}")

# Main function to open links in Firefox, configure extension, log results and console output
def open_links_in_firefox(
    links,
    extension_dir,
    geckodriver_path,
    mode,
    threshold,
    log_url_file,
    log_console_file,
    firefox_binary_path=None,
    timeout=30
):
    # Temporary path for the packaged extension
    packaged_extension_path = os.path.join(os.path.dirname(extension_dir), "temp_fp_tracer_extension.xpi")
    
    # Package the extension directory into a .xpi file
    package_extension(extension_dir, packaged_extension_path)
    
    # Set up Firefox options
    options = Options()
    options.headless = True  # Set to False if you want to see the browser
    options.add_extension(packaged_extension_path)
    
    if firefox_binary_path:
        options.binary_location = firefox_binary_path
    
    # Set desired capabilities for capturing console logs
    capabilities = DesiredCapabilities.FIREFOX.copy()
    capabilities['loggingPrefs'] = {'browser': 'ALL'}
    
    # Initialize WebDriver
    service = Service(executable_path=geckodriver_path)
    try:
        driver = webdriver.Firefox(service=service, options=options, desired_capabilities=capabilities)
        print("Firefox launched successfully.")
    except Exception as e:
        print(f"Failed to start Firefox: {e}")
        return
    
    try:
        # Allow some time for the extension to load
        time.sleep(3)
        
        # Configure the extension's settings via injected JavaScript
        set_extension_settings(driver, mode, threshold)
        
        # Iterate through each link and perform crawling
        for link in links:
            formatted_link = format_link(link)
            try:
                driver.get(formatted_link)
                print(f"Opened {formatted_link}")
                
                # Wait for the page to load completely by checking the readyState
                page_loaded = False
                final_state = None
                for _ in range(timeout):
                    final_state = driver.execute_script("return document.readyState")
                    if final_state == "complete":
                        page_loaded = True
                        break
                    time.sleep(1)
                
                # Fetch browser console logs
                try:
                    console_logs = driver.get_log('browser')
                except Exception as e:
                    console_logs = []
                    print(f"Error fetching console logs: {e}")
                
                # Log final state and outcome
                if page_loaded:
                    log_url_state(log_url_file, formatted_link, "success", final_state=final_state)
                    print(f"Page loaded successfully: {formatted_link}")
                else:
                    log_url_state(log_url_file, formatted_link, "failed_to_load", final_state=final_state)
                    print(f"Page failed to load within timeout: {formatted_link}")
                
                # Log console output
                log_console_output(log_console_file, formatted_link, console_logs)
                
            except WebDriverException as e:
                # Fetch console logs even if there's an error
                try:
                    console_logs = driver.get_log('browser')
                except Exception:
                    console_logs = []
                final_state = driver.execute_script("return document.readyState")
                log_url_state(log_url_file, formatted_link, "error", str(e), final_state=final_state)
                log_console_output(log_console_file, formatted_link, console_logs)
                print(f"Error loading {formatted_link}: {e}")
                continue  # Skip to the next link
                
    except Exception as e:
        print(f"An unexpected error occurred during crawling: {e}")
    finally:
        # Close the browser window
        driver.quit()
        print("Firefox closed.")
        
        # Optionally, remove the temporary .xpi file
        if os.path.exists(packaged_extension_path):
            os.remove(packaged_extension_path)
            print(f"Temporary extension file removed: {packaged_extension_path}")

if __name__ == "__main__":
    # Define your configurations
    configurations = [
        {"mode": "entropy", "threshold": 1.9, "log_url": "url_log_1.9.txt", "log_console": "console_log_1.9.txt"},
        {"mode": "entropy", "threshold": 0.83, "log_url": "url_log_0.83.txt", "log_console": "console_log_0.83.txt"},
        {"mode": "entropy", "threshold": 0.705, "log_url": "url_log_0.705.txt", "log_console": "console_log_0.705.txt"},
        {"mode": "entropy", "threshold": 0.596, "log_url": "url_log_0.596.txt", "log_console": "console_log_0.596.txt"},
        {"mode": "entropy", "threshold": 0.442, "log_url": "url_log_0.442.txt", "log_console": "console_log_0.442.txt"},
    ]
    
    # Ask user for the file path to the links list
    links_file_path = input("Enter the path to the links list file: ").strip()
    if not os.path.exists(links_file_path):
        print(f"Links file not found: {links_file_path}")
        exit(1)
    
    # Read links from the specified file
    links = read_links(links_file_path)
    
    # Ask user for the extension directory path
    extension_dir = input("Enter the path to your extension directory (containing manifest.json): ").strip()
    if not os.path.exists(extension_dir):
        print(f"Extension directory not found: {extension_dir}")
        exit(1)
    
    # Ask user for the geckodriver path
    geckodriver_path = input("Enter the path to the geckodriver executable: ").strip()
    if not os.path.exists(geckodriver_path):
        print(f"Geckodriver not found: {geckodriver_path}")
        exit(1)
    
    # Optionally, ask for Firefox binary location
    firefox_binary_path = input("Enter the path to the Firefox binary (press Enter to use default): ").strip()
    if not firefox_binary_path:
        firefox_binary_path = None  # Use default
    
    # Iterate through each configuration and perform crawling
    for config in configurations:
        mode = config["mode"]
        threshold = config["threshold"]
        log_url_file = config["log_url"]
        log_console_file = config["log_console"]
        print(f"\n--- Starting crawling with mode: {mode}, threshold: {threshold} ---")
    
        # Clear previous logs if they exist
        if os.path.exists(log_url_file):
            os.remove(log_url_file)
            print(f"Previous URL log removed: {log_url_file}")
        if os.path.exists(log_console_file):
            os.remove(log_console_file)
            print(f"Previous console log removed: {log_console_file}")
    
        # Open links in Firefox using the specified configuration and log the results
        open_links_in_firefox(
            links=links,
            extension_dir=extension_dir,
            geckodriver_path=geckodriver_path,
            mode=mode,
            threshold=threshold,
            log_url_file=log_url_file,
            log_console_file=log_console_file,
            firefox_binary_path=firefox_binary_path,
            timeout=30  # Adjust timeout as needed
        )
        print(f"--- Completed crawling with mode: {mode}, threshold: {threshold} ---")
    
    print("\nAll configurations have been processed.")

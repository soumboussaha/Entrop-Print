from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.common.exceptions import WebDriverException
import time
import os

# Function to read links from a text file
def read_links(file_path):
    with open(file_path, 'r') as file:
        return file.read().splitlines()

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

# Main function to open links in Firefox, log results and console output
def open_links_in_firefox(links, firefox_profile_path, geckodriver_path, url_log_file_path, console_log_file_path, timeout=30):
    # Set up Firefox options with the profile
    options = Options()
    options.profile = firefox_profile_path
    options.add_argument("--headless")
    options.binary_location = r'/usr/local/bin/firefox-developer'  # Adjust if the path is different!

    # Enable logging capabilities to capture browser console output
    capabilities = DesiredCapabilities.FIREFOX
    capabilities['loggingPrefs'] = {'browser': 'ALL'}

    # Start Firefox with the specified profile and logging capabilities
    service = Service(executable_path=geckodriver_path)
    driver = webdriver.Firefox(service=service, options=options, desired_capabilities=capabilities)

    for link in links:
        link = format_link(link)
        try:
            driver.get(link)

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
            console_logs = driver.get_log('browser')

            # Log final state and outcome
            if page_loaded:
                log_url_state(url_log_file_path, link, "success", final_state=final_state)
            else:
                log_url_state(url_log_file_path, link, "failed_to_load", final_state=final_state)

            # Log console output
            log_console_output(console_log_file_path, link, console_logs)

        except WebDriverException as e:
            # Fetch console logs even if there's an error
            console_logs = driver.get_log('browser')
            final_state = driver.execute_script("return document.readyState")
            log_url_state(url_log_file_path, link, "error", str(e), final_state=final_state)
            log_console_output(console_log_file_path, link, console_logs)
            print(f"Error loading {link}: {e}")
            continue  # Skip to the next link

    # Close the browser window
    driver.quit()

if __name__ == "__main__":
    # Ask user for the file path to the links list
    links_file_path = input("Enter the path to the links list file: ")

    # Ask user for the Firefox profile path
    firefox_profile_path = input("Enter the path to the Firefox profile: ")

    # Ask user for the geckodriver path
    geckodriver_path = input("Enter the path to the geckodriver executable: ")

    # Ask user for the URL state log file path
    url_log_file_path = input("Enter the path to the URL log file (or press Enter for 'url_log.txt'): ")
    if not url_log_file_path:
        url_log_file_path = "url_log.txt"  # Default URL state log file name

    # Ask user for the console log file path
    console_log_file_path = input("Enter the path to the console log file (or press Enter for 'console_log.txt'): ")
    if not console_log_file_path:
        console_log_file_path = "console_log.txt"  # Default console log file name

    # Make sure the log files are empty before starting
    if os.path.exists(url_log_file_path):
        os.remove(url_log_file_path)

    if os.path.exists(console_log_file_path):
        os.remove(console_log_file_path)

    # Read links from the specified file
    links = read_links(links_file_path)

    # Open links in Firefox using the specified profile and geckodriver, and log the results and console logs
    open_links_in_firefox(links, firefox_profile_path, geckodriver_path, url_log_file_path, console_log_file_path)

